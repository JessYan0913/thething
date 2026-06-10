"use client"

import { TShapeWithStars } from "@/components/TShapeWithStars"
import { TShapeBlink } from "@/components/TShapeBlink"

export default function TestAnimationPage() {
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">
          T形小人动画测试
        </h1>

        {/* 眨眼动画 */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">
            眨眼动画
          </h2>
          <div className="flex justify-center items-center p-8 bg-gray-50 rounded-lg">
            <div className="w-96 h-auto">
              <TShapeBlink />
            </div>
          </div>
          <div className="mt-4 text-gray-600 space-y-2">
            <p>• 线条绘制动画 → 眼睛自动眨动</p>
            <p>• 眨眼频率：随机 2-5 秒一次</p>
            <p>• 眨眼效果：眼睛快速闭合再打开</p>
          </div>
        </div>

        {/* 星星闪烁动画 */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">
            星星闪烁动画
          </h2>
          <div className="flex justify-center items-center p-8 bg-gray-50 rounded-lg">
            <div className="w-96 h-auto">
              <TShapeWithStars />
            </div>
          </div>
          <div className="mt-4 text-gray-600 space-y-2">
            <p>• T形小人（深色主体）保持静态不动</p>
            <p>• 右上角的星星（紫色）持续闪烁</p>
            <p>• 闪烁周期：2秒，无限循环</p>
            <p>• 动画效果：透明度在 1 → 0.3 → 1 → 0.5 → 1 之间变化</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">
            组件导入
          </h2>
          <pre className="text-sm text-gray-600 bg-gray-100 p-3 rounded overflow-x-auto">
{`import { TShapeBlink } from "@/components/TShapeBlink"
import { TShapeWithStars } from "@/components/TShapeWithStars"

// 眨眼动画
<TShapeBlink />

// 星星闪烁动画
<TShapeWithStars />`}
          </pre>
        </div>
      </div>
    </div>
  )
}
