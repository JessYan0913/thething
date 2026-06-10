"use client"

import { motion, useAnimationControls } from "motion/react"
import { useEffect, useRef } from "react"

/**
 * TShapeBlink
 * T形小人眨眼动画 — 线条绘制 + 眼睛眨动
 * Generated from svg-to-motion, customized for blinking effect
 */

// Eye center coordinates for transform-origin
const LEFT_EYE_CENTER = { x: 778.5, y: 857 }
const RIGHT_EYE_CENTER = { x: 1063.5, y: 857 }

// Eye paths
const LEFT_EYE =
  "M 778.5 811 Q 789.4 809.6 796.5 812 Q 807.8 816.2 814 825.5 L 821 840.5 L 823 870.5 L 819 888.5 Q 814.7 898.2 806.5 904 Q 797.7 911.7 778.5 909 Q 764.9 906.1 758 896.5 L 754 889.5 L 752 881.5 L 751 853.5 L 752 852.5 L 752 840.5 L 755 828.5 Q 758.3 820.8 764.5 816 L 769.5 813 L 778.5 811 Z"

const RIGHT_EYE =
  "M 1057.5 811 Q 1082.6 809.4 1091 824.5 L 1095 830.5 L 1098 841.5 L 1100 871.5 L 1099 872.5 L 1098 884.5 L 1095 891.5 L 1083.5 904 L 1078.5 907 L 1069.5 909 L 1056.5 909 L 1046.5 906 L 1038 897.5 L 1030 881.5 Q 1031.5 876 1029 874.5 L 1029 846.5 L 1031 835.5 L 1034 827.5 L 1044.5 816 L 1057.5 811 Z"

// Body path (main T-shape outline, dark color)
const BODY_PATH =
  "M 840.5 596 L 1165.5 596 L 1166.5 597 L 1202.5 597 L 1203.5 598 L 1211.5 598 L 1236.5 603 L 1262.5 611 L 1299.5 628 Q 1338.9 650.1 1368 682.5 Q 1384 702 1397 724.5 Q 1410.9 750.6 1420 781.5 L 1430 828.5 L 1431 850.5 L 1432 851.5 L 1432 891.5 L 1431 892.5 L 1431 902.5 L 1430 903.5 L 1428 922.5 L 1423 943.5 Q 1416.2 968.2 1406 989.5 Q 1395.7 1013.7 1380 1032.5 L 1344.5 1070 Q 1330.2 1083.7 1312.5 1094 L 1270.5 1113 L 1244.5 1122 L 1222.5 1127 L 1209.5 1128 L 1208.5 1129 L 1197.5 1129 L 1196.5 1130 L 1146.5 1130 L 1145.5 1131 L 1122.5 1131 Q 1121 1133.5 1115.5 1132 Q 1093.9 1139.4 1082 1156.5 L 1078 1163.5 L 1077 1168.5 L 1077 1380.5 L 1076 1381.5 L 1076 1406.5 L 1075 1407.5 L 1075 1415.5 L 1069 1446.5 L 1060 1469.5 Q 1048.5 1491 1031.5 1507 Q 1009.5 1527 979.5 1539 L 942.5 1549 L 909.5 1549 L 881.5 1543 L 855.5 1533 Q 828.1 1519.4 809 1497.5 Q 792.8 1478.7 782 1454.5 L 776 1437.5 L 772 1418.5 Q 773.5 1413 771 1411.5 L 771 1391.5 L 770 1390.5 L 770 1164.5 Q 766.8 1145.2 754.5 1135 L 747.5 1132 L 737.5 1130 L 649.5 1130 L 648.5 1129 L 627.5 1127 L 597.5 1120 Q 562.2 1109.8 533.5 1093 Q 508.5 1077.5 489 1056.5 Q 473.8 1040.2 462 1020.5 L 449 996.5 L 433 958.5 L 428 942.5 L 422 911.5 L 422 903.5 L 421 902.5 L 420 886.5 L 419 885.5 L 419 849.5 L 420 848.5 L 421 828.5 L 422 827.5 L 422 820.5 L 423 819.5 L 426 796.5 L 431 776.5 L 441 750.5 Q 457 717.5 477 688.5 L 498.5 665 L 517.5 650 L 560.5 623 L 585.5 611 L 620.5 601 L 640.5 599 L 641.5 598 L 656.5 598 L 657.5 597 L 839.5 597 L 840.5 596 Z M 1006 741 L 1005 742 L 698 742 L 697 743 L 690 743 L 673 746 L 655 752 Q 639 759 628 770 Q 610 786 597 808 L 587 834 L 583 856 L 583 876 Q 586 877 584 883 L 590 904 Q 598 923 611 938 Q 630 961 660 974 L 672 978 L 683 979 L 684 980 L 716 980 L 717 981 L 1108 981 L 1109 980 L 1162 980 L 1163 979 L 1171 979 L 1180 977 L 1196 971 Q 1212 963 1226 952 Q 1242 938 1251 917 L 1260 893 L 1264 873 L 1264 849 L 1261 833 Q 1252 805 1237 784 Q 1214 754 1172 745 L 1157 744 L 1156 743 L 1141 743 L 1140 742 L 1006 741 Z"

export function TShapeBlink() {
  const leftEyeControls = useAnimationControls()
  const rightEyeControls = useAnimationControls()

  // Track mount state to stop the blink loop on unmount
  const mountedRef = useRef(true)

  // Start blinking after initial draw-in
  useEffect(() => {
    const timer = setTimeout(async () => {
      while (mountedRef.current) {
        try {
          // Close eyes
          await leftEyeControls.start({
            scaleY: 0.05,
            transition: { duration: 0.1, ease: "easeInOut" },
          })
          await rightEyeControls.start({
            scaleY: 0.05,
            transition: { duration: 0.1, ease: "easeInOut" },
          })

          // Hold closed briefly
          await new Promise((r) => setTimeout(r, 80))

          // Open eyes
          await leftEyeControls.start({
            scaleY: 1,
            transition: { duration: 0.15, ease: "easeInOut" },
          })
          await rightEyeControls.start({
            scaleY: 1,
            transition: { duration: 0.15, ease: "easeInOut" },
          })

          // Random pause between blinks (2-5 seconds)
          await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000))
        } catch {
          // Component unmounted during animation — stop loop
          break
        }
      }
    }, 2000) // Start blinking 2s after draw-in completes

    return () => {
      mountedRef.current = false
      clearTimeout(timer)
    }
  }, [leftEyeControls, rightEyeControls])

  return (
    <motion.svg
      viewBox="0 0 1832 2192"
      initial="hidden"
      animate="visible"
      style={{ width: "100%", height: "auto" }}
    >
      {/* Body outline — line drawing */}
      <motion.g>
        <motion.path
          d={BODY_PATH}
          fill="rgb(15,19,36)"
          stroke="rgb(15,19,36)"
          strokeWidth={1}
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            visible: {
              pathLength: 1,
              opacity: 1,
              transition: {
                pathLength: {
                  duration: 1.5,
                  delay: 0,
                  ease: "easeInOut",
                },
                opacity: {
                  duration: 0.1,
                  delay: 0,
                },
              },
            },
          }}
        />
      </motion.g>

      {/* Left eye — line draw then blink */}
      <motion.path
        d={LEFT_EYE}
        fill="rgb(15,19,36)"
        stroke="rgb(15,19,36)"
        strokeWidth={1}
        style={{
          transformOrigin: `${LEFT_EYE_CENTER.x}px ${LEFT_EYE_CENTER.y}px`,
        }}
        variants={{
          hidden: { pathLength: 0, opacity: 0, scaleY: 1 },
          visible: {
            pathLength: 1,
            opacity: 1,
            scaleY: 1,
            transition: {
              pathLength: {
                duration: 0.8,
                delay: 0.5,
                ease: "easeInOut",
              },
              opacity: {
                duration: 0.1,
                delay: 0.5,
              },
            },
          },
        }}
        animate={leftEyeControls}
      />

      {/* Right eye — line draw then blink */}
      <motion.path
        d={RIGHT_EYE}
        fill="rgb(15,19,36)"
        stroke="rgb(15,19,36)"
        strokeWidth={1}
        style={{
          transformOrigin: `${RIGHT_EYE_CENTER.x}px ${RIGHT_EYE_CENTER.y}px`,
        }}
        variants={{
          hidden: { pathLength: 0, opacity: 0, scaleY: 1 },
          visible: {
            pathLength: 1,
            opacity: 1,
            scaleY: 1,
            transition: {
              pathLength: {
                duration: 0.8,
                delay: 0.5,
                ease: "easeInOut",
              },
              opacity: {
                duration: 0.1,
                delay: 0.5,
              },
            },
          },
        }}
        animate={rightEyeControls}
      />
    </motion.svg>
  )
}
