# Agent记忆系统实施文档(基于设计框架v3)

本文档面向开发实现,将v3理论框架转化为数据结构、处理流程和分阶段实施计划。本文档假设本地存储、单用户场景。

---

## 一、数据结构设计

### 1.1 记忆记录(Memory Record)— 核心单元

每条记忆是一条独立记录,字段设计直接对应框架各部分:

```yaml
memory_record:
  id: string                    # 唯一标识
  content: string                # 记忆内容(自然语言描述)
  layer: enum                    # identity / state / pattern  (第二部分)
  
  # 写入路径与来源(第三、七部分)
  source_type: enum              # explicit / implicit / dream_derived / user_edit
  source_session_refs: [string]  # 指向原始会话的轻量引用,供溯源(9.2)
  
  # 两轴置信度(第四部分)
  reliability: float             # 0-1,来源可靠性
  recency: float                 # 0-1,时效性,随时间衰减,被验证时重置
  last_verified_at: timestamp
  
  # 状态性记忆专用(第二部分)
  version_history: [string]      # 指向旧版本记录id的列表(仅state层使用)
  status: enum                    # active / superseded / pending_verification
  
  # 模式性记忆专用
  sample_count: int               # 支撑该模式的样本数(第二部分最小样本门槛)
  
  # 可见性控制(第九部分)
  visibility: enum                # visible / hidden_until_promoted / internal_only
  
  created_at: timestamp
  updated_at: timestamp
```

### 1.2 关联边(Association Edge)

```yaml
association_edge:
  from_id: string
  to_id: string
  co_occurrence_count: int        # 共现次数(第六部分附录A)
  reinforcement_score: float      # 共同促成好结果的强化分数
  last_reinforced_at: timestamp
  weight: float                   # 综合权重 = f(co_occurrence, reinforcement, 时间衰减)
```

### 1.3 冷却池条目(Cooling Pool Entry)

```yaml
cooling_pool_entry:
  candidate_content: string
  related_topics: [string]        # 激活条件标签,供焦点切换时匹配
  first_seen_at: timestamp
  last_activated_at: timestamp
  activation_count: int
  revival_count: int               # 已使用的"续命"次数,上限3(第九部分附录A)
  repeat_count: int                # 跨重组周期重复出现次数(筛选2)
```

### 1.4 来源类型质量统计(Source Quality Stats)

```yaml
source_quality_stats:
  source_type: enum
  rolling_window: [outcome]        # 最近N条该来源记录的验证结果(对/错)
  current_accuracy: float          # 滚动准确率,用于校准该来源新记录的初始reliability
```

### 1.5 用户控制配置(User Control Config)

```yaml
user_control_config:
  deep_processing_enabled: bool        # 9.4
  implicit_inference_excluded_topics: [string]  # 9.4
  passive_verification_enabled: bool   # 9.4
```

---

## 二、处理流程

### 2.1 在线流程(每轮对话)

```
1. 接收用户输入
2. 检索:
   a. 向量相似度初筛 → 候选集
   b. 沿关联边扩散1-2步 → 扩展候选集
   c. 按两轴置信度重排(根据query类型决定reliability/recency权重)
   d. 过滤 visibility != internal_only,按token预算截断
3. 注入prompt,生成响应
4. 异步(不阻塞响应):
   a. 提取本轮新信息(显式声明 / 隐式信号)
   b. 写入对应layer,source_type标记正确
   c. 若涉及已有state层记录,创建新版本,旧版本status=superseded
   d. 若命中user_control_config中的排除主题,跳过隐式写入
```

### 2.2 轻量离线处理(每次会话结束触发)

```
1. 对本次会话新写入的记录:
   a. 去重(与已有记录相似度过高的合并)
   b. 冲突检测(与已有state层记录矛盾的,标记冲突,旧记录superseded)
2. 更新关联边:
   a. 本次会话中共同出现的记忆对,co_occurrence_count += 1
3. 更新累积压力信号计数
```

### 2.3 深度离线处理(双信号触发:压力信号达阈值 且 会话已结束/空闲)

```
前置检查:user_control_config.deep_processing_enabled == false → 跳过

1. 加锁:本次处理涉及的记忆范围对在线检索标记为"锁定上一版本"
2. 跨记忆关联发现:
   a. 基于关联图,寻找未被现有pattern层记录覆盖的强连接子图
   b. 生成候选关联描述(LLM调用)
3. 双重筛选:
   a. 筛选1(相关性):与当前state层记录关联 → 进入快速通道;否则 → 写入cooling_pool_entry
   b. 筛选2(重复性):候选与历史临时假设比对,repeat_count += 1;
      若repeat_count >= N → 写入memory_record(source_type=dream_derived, 
      reliability=source_quality_stats[dream_derived].current_accuracy,
      visibility=hidden_until_promoted)
4. 冷却池维护:
   a. 本轮state层记录变化(焦点切换)作为query,扫描cooling_pool匹配related_topics
   b. 命中的entry: activation_count += 1, last_activated_at刷新
      若 revival_count < 3: revival_count += 1, 重新进入步骤3b的repeat_count判断
      否则: 标记淘汰
   c. 容量超限时,优先淘汰 activation_count==0 且 first_seen_at最早 的条目
5. 关联边衰减:weight低于阈值且last_reinforced_at超出窗口的边 → 删除
6. 解锁,整体切换到新版本
```

### 2.4 被动验证(在线流程的延伸,持续运行)

```
每轮响应生成后,检查本轮是否使用了 visibility=hidden_until_promoted 的记录:
  若使用:
    记录本次"假设影响的具体行为点"
    下一轮用户反馈中:
      若用户纠正/否定相关内容 → reliability -= delta(负向,幅度较大)
      若用户接受/无异议(经过若干轮未被纠正) → reliability += delta(正向,幅度较小)
    若 reliability 超过晋升阈值:
      visibility = visible, layer = pattern (sample_count相应记录)
      → 触发9.5的"晋升通知"(向用户展示该内容,提供纠正机会)
    若用户在晋升通知中纠正:
      → 强负向信号,写入source_quality_stats[dream_derived]
        (权重高于普通被动验证信号,见9.3)
```

### 2.5 用户主动编辑/查询(第九部分)

```
查询"系统记得我什么":
  返回 layer in (identity, state) 的 visible 记录,以及 layer=pattern 的 visible 记录
  (不返回 hidden_until_promoted 和 cooling_pool 内容)

查询"为什么记得这个/为什么这样回应":
  按 memory_record.source_session_refs 追溯原始会话上下文
  返回:source_type、首次记录时间、最近验证时间

用户编辑/删除某条记录:
  直接写入新版本/标记删除,绕过冲突检测
  若被编辑记录的source_type in (implicit, dream_derived):
    强负向信号 → source_quality_stats[该source_type],权重最高
```

---

## 三、分阶段实施计划

不建议一次性实现全部机制。按依赖关系和价值密度排序:

### 阶段一:基础读写(对应第二、三部分)
- 实现memory_record结构,三层分类
- 实现显式写入路径(用户说"记住"即写入,source_type=explicit, reliability=高)
- 实现状态层版本化
- 实现基础检索(向量相似度,暂不做关联扩散)
- 实现9.1的可见性分层(此阶段只有explicit记录,直接visible即可)
- 实现用户查询"系统记得我什么"(9.2/9.5的最小版本)

**此阶段交付一个可用的"显式记忆"系统**,价值已经显著(对应最初讨论的MVP)。

### 阶段二:隐式写入 + 反馈环(对应第二、三、七部分)
- 实现隐式写入路径(异步提取归纳)
- 实现pattern层的反馈环(使用后根据结果调整置信度)
- 实现两轴置信度(reliability/recency分离)
- 实现source_quality_stats(按来源类型的滚动准确率)
- 实现9.4的过程级控制开关(此时才有"隐式归纳"可供关闭)

### 阶段三:关联检索(对应第四部分)
- 实现association_edge结构与共现统计
- 实现检索时的关联扩散
- 此时9.1的展示可以加入"基于多次互动归纳"的标注

### 阶段四:离线深度处理(对应第五、六部分)
- 实现轻量离线处理(会话结束触发)
- 实现双信号判定与深度离线处理
- 实现cooling_pool_entry与双重筛选
- 实现关联边的强化与衰减剪枝

### 阶段五:被动验证与晋升(对应第六、九部分)
- 实现hidden_until_promoted状态与被动验证流程
- 实现晋升通知(9.5)
- 完善用户编辑的纠错传播(9.3)

---

## 四、关键参数清单(初始建议值,需实践调优)

| 参数 | 含义 | 初始建议值 |
|---|---|---|
| 筛选2重复阈值N | 候选关联需独立重组中出现几次才晋升临时假设 | 3 |
| 冷却池续命上限 | revival_count上限 | 3 |
| 边权重衰减窗口 | 多久未强化的边视为可剪枝 | 30天(可参考时效性衰减的半衰期设定) |
| 被动验证负向信号幅度 | 用户纠正时reliability下调幅度 | 远大于正向幅度(建议5-10倍) |
| 晋升阈值 | hidden_until_promoted → visible所需reliability | 待实践确定,建议初始设较高,观察晋升频率后调整 |
| source_quality_stats窗口 | 滚动准确率统计的样本窗口 | 最近50条该来源记录 |

**说明**:这些参数不应暴露给用户(对应9.4的"粗粒度开关"原则),但开发阶段应该设计为可配置,便于离线评估和调优。

---

## 五、与产品体验相关的非功能性要求

- 阶段一上线时,即应提供"查看/删除记忆"的界面入口——这是用户信任建立的起点,不应等到后续阶段
- 9.5的晋升通知,应设计为**非阻塞、可忽略**的形式(类似提示而非弹窗确认),避免打断主流程
- source_session_refs指向的原始会话内容,应遵循正常的数据保留策略——若用户删除某次会话,引用该会话的记忆记录的溯源信息会失效,需要有"溯源信息缺失"时的优雅降级(显示"来源:较早的对话"而非报错)
