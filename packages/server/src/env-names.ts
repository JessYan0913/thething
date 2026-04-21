// ============================================================
// Environment Variables - Server 环境变量定义
// ============================================================
// Server 作为应用层，负责定义和读取环境变量
// Core 模块不读取环境变量，配置由应用层传入

/** 环境变量：模型名称 */
export const ENV_MODEL = 'THETHING_MODEL';

/** 环境变量：模型上下文限制 */
export const ENV_CONTEXT_LIMIT = 'THETHING_MODEL_CONTEXT_LIMIT';

/** 环境变量：模型输出预留 */
export const ENV_OUTPUT_TOKENS = 'THETHING_MODEL_OUTPUT_TOKENS';

/** 环境变量：DashScope API Key */
export const ENV_DASHSCOPE_API_KEY = 'DASHSCOPE_API_KEY';

/** 环境变量：DashScope Base URL */
export const ENV_DASHSCOPE_BASE_URL = 'DASHSCOPE_BASE_URL';