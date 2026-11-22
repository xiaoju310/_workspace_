import { Icon } from './ui'

/** 页面背景层：水彩晕染 + 纸屑，纯装饰，不拦截任何点击 */
export function SceneBackdrop({ tone = 'warm' }: { tone?: 'warm' | 'cool' | 'deep' }) {
  return (
    <div className={`scene scene--${tone}`} aria-hidden="true">
      <span className="scene-wash scene-wash-a" />
      <span className="scene-wash scene-wash-b" />
      <span className="scene-wash scene-wash-c" />
      <span className="scene-scrap scrap-a" />
      <span className="scene-scrap scrap-b" />
      <span className="scene-scrap scrap-c" />
      <span className="scene-grain" />
    </div>
  )
}

/** 星点装饰：位置由 CSS 类控制，避免内联样式散落 */
export function OrnamentStars({ count = 5 }: { count?: number }) {
  return (
    <div className="ornament-layer" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={`ornament ornament--star star-${(index % 6) + 1}`}>
          <Icon name="spark" size={index % 3 === 0 ? 22 : 15} strokeWidth={1.2} />
        </span>
      ))}
    </div>
  )
}

/**
 * 首页主视觉：一本打开的立体纸艺绘本，书页中长出一片森林。
 * 全部为内联 SVG，无外部依赖；图层从前到后依次绘制，靠阴影与错位形成纵深。
 */
export function HeroScene() {
  return (
    <svg className="hero-art" viewBox="0 0 720 560" role="img" aria-label="一本打开的纸艺绘本，书页中升起森林、山峦与一弯月亮">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#f6efe0" />
          <stop offset="1" stopColor="#e7efe9" />
        </linearGradient>
        <linearGradient id="hillBack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a9bfae" />
          <stop offset="1" stopColor="#8ba697" />
        </linearGradient>
        <linearGradient id="hillMid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fa295" />
          <stop offset="1" stopColor="#5f857a" />
        </linearGradient>
        <linearGradient id="pageLeft" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#fffdf5" />
          <stop offset="1" stopColor="#f0e9d8" />
        </linearGradient>
        <linearGradient id="pageRight" x1="1" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#fffdf6" />
          <stop offset="1" stopColor="#eee6d3" />
        </linearGradient>
        <linearGradient id="cover" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f6f74" />
          <stop offset="1" stopColor="#1d474b" />
        </linearGradient>
        <radialGradient id="moon" cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#fff7e2" />
          <stop offset="1" stopColor="#e8bc58" />
        </radialGradient>
        <filter id="paperShadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#17393d" floodOpacity="0.22" />
        </filter>
        <filter id="softShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#17393d" floodOpacity="0.16" />
        </filter>
      </defs>

      {/* 背景层：天空、月亮、云 */}
      <rect x="34" y="26" width="652" height="470" rx="44" fill="url(#sky)" />
      <circle cx="574" cy="122" r="52" fill="url(#moon)" opacity="0.95" />
      <g fill="#fffdf6" opacity="0.85" filter="url(#softShadow)">
        <path d="M126 150c14-26 52-24 62 2 18-6 34 6 34 22H96c0-18 14-28 30-24Z" />
        <path d="M420 96c10-19 38-18 46 1 13-4 24 4 24 16H398c0-13 10-20 22-17Z" opacity="0.7" />
      </g>

      {/* 中景层：三层山峦 */}
      <path d="M34 400c70-58 118-92 176-92 62 0 96 44 152 44 52 0 84-36 142-36 60 0 100 38 182 76v104H34Z" fill="url(#hillBack)" filter="url(#softShadow)" />
      <path d="M34 436c78-46 128-66 190-66 66 0 92 34 148 34 54 0 84-26 138-26 46 0 76 22 176 62v92H34Z" fill="url(#hillMid)" filter="url(#softShadow)" />

      {/* 立体纸艺植物：从书页里长出 */}
      <g filter="url(#softShadow)">
        <path d="M336 386V262" stroke="#3f6154" strokeWidth="7" strokeLinecap="round" />
        <path d="M336 300c-26-6-44-24-50-50 28 0 48 16 56 42Z" fill="#6f8f6a" />
        <path d="M336 286c24-8 40-26 44-52-26 2-44 18-50 44Z" fill="#8fae83" />
        <path d="M336 252c-18-6-30-20-34-40 20 2 34 14 40 34Z" fill="#b7cc9d" />
      </g>
      <g filter="url(#softShadow)" opacity="0.95">
        <path d="M470 400V300" stroke="#3f6154" strokeWidth="6" strokeLinecap="round" />
        <path d="M470 330c20-4 34-18 38-38-22 0-36 12-42 32Z" fill="#7f9d72" />
        <path d="M470 316c-18-6-28-18-32-36 20 2 32 12 36 30Z" fill="#a3bd8d" />
      </g>

      {/* 前景层：一本打开的书 */}
      <g filter="url(#paperShadow)">
        <path d="M120 404c58-22 128-24 190-6v118c-62-18-132-16-190 6Z" fill="url(#pageLeft)" />
        <path d="M600 404c-58-22-128-24-190-6v118c62-18 132-16 190 6Z" fill="url(#pageRight)" />
        <path d="M310 398h100v118h-100Z" fill="#e3d9c2" />
        <path d="M120 404c58-22 128-24 190-6-62 20-130 22-190 6Z" fill="#d9cdb4" opacity="0.55" />
        <path d="M600 404c-58-22-128-24-190-6 62 20 130 22 190 6Z" fill="#d9cdb4" opacity="0.55" />
        <path d="M96 392c62-26 140-28 206-8v124c-66-20-144-18-206 8Z" fill="url(#cover)" />
        <path d="M624 392c-62-26-140-28-206-8v124c66-20 144-18 206 8Z" fill="url(#cover)" />
      </g>

      {/* 书页上的文字线：暗示"读到的内容" */}
      <g stroke="#c9bda3" strokeWidth="4" strokeLinecap="round" opacity="0.8">
        <path d="M160 452h110M160 474h86M160 496h120" />
        <path d="M452 452h112M474 474h90M452 496h96" />
      </g>

      {/* 浮动纸片与小书 */}
      <g filter="url(#softShadow)">
        <g transform="rotate(-13 168 214)">
          <rect x="118" y="164" width="96" height="118" rx="10" fill="#f5e6c9" />
          <rect x="128" y="176" width="76" height="60" rx="6" fill="#e9c7a2" />
          <rect x="128" y="246" width="52" height="7" rx="3.5" fill="#c9a67f" />
        </g>
        <g transform="rotate(11 552 250)">
          <rect x="510" y="200" width="86" height="108" rx="9" fill="#e2e6f2" />
          <circle cx="553" cy="240" r="20" fill="#b3a8d8" />
          <rect x="524" y="272" width="58" height="6" rx="3" fill="#a9a3c6" />
          <rect x="524" y="286" width="40" height="6" rx="3" fill="#c3bedd" />
        </g>
        <g transform="rotate(28 620 330)">
          <rect x="596" y="304" width="52" height="66" rx="7" fill="#f7dfd7" />
          <rect x="604" y="314" width="36" height="30" rx="4" fill="#e7b0a1" />
        </g>
      </g>

      {/* 星点 */}
      <g fill="#e8bc58">
        <path d="m250 116 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" />
        <path d="m470 150 2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4Z" opacity="0.8" />
        <path d="m640 206 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" opacity="0.65" />
      </g>
    </svg>
  )
}
