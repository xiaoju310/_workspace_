/** 用户提供的猫头鹰素材；透明底保留羽毛细节，与故事中的动物角色无关。 */
export function OwlMascot({ size = 96, className = '' }: { size?: number; className?: string }) {
  return <img className={`owl-mascot ${className}`.trim()} src="/art/reading-owl.png"
    width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}
