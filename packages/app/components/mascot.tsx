"use client";

import { useRef } from "react";
import type { LottieRefCurrentProps } from "lottie-react";
import Lottie from "lottie-react";
import { cn } from "@/lib/utils";
import animationData from "@/public/sparkle-flash.json";

interface MascotProps {
  className?: string;
  size?: number;
  loop?: boolean;
  autoplay?: boolean;
  speed?: number;
}

/**
 * TheThing T小人 交互动画
 *
 * 基于 Lottie 的动画组件，使用 mshk-image-to-lottie.json 动画文件
 * 支持控制播放速度、循环、自动播放等
 */
export function Mascot({
  className,
  size = 200,
  loop = true,
  autoplay = true,
  speed = 0.2,
}: MascotProps) {
  const lottieRef = useRef<LottieRefCurrentProps>(null);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <Lottie
        lottieRef={lottieRef}
        animationData={animationData}
        loop={loop}
        autoplay={autoplay}
        style={{ width: "100%", height: "100%" }}
        onDOMLoaded={() => {
          if (lottieRef.current) {
            lottieRef.current.setSpeed(speed);
          }
        }}
      />
    </div>
  );
}

export default Mascot;
