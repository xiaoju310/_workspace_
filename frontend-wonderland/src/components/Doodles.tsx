import type { CSSProperties } from 'react'

type DoodleName = 'cloud' | 'sun' | 'squiggle' | 'arrow' | 'star' | 'leaf' | 'rainbow' | 'fox' | 'rabbit' | 'balloon' | 'pencil' | 'heart' | 'spiral' | 'sparkle'

/** 手绘感的童趣涂鸦：纯内联 SVG，可当装饰，也可当空状态的插画 */
export function Doodle({ name, size = 120, className = '', style }: { name: DoodleName; size?: number; className?: string; style?: CSSProperties }) {
  const common = { viewBox: '0 0 120 120', width: size, height: size, 'aria-hidden': true as const, className: `doodle ${className}`.trim(), style, focusable: 'false' as const }
  switch (name) {
    case 'cloud':
      return (
        <svg {...common} fill="none">
          <path d="M26 78c-10 0-17-7-17-16s7-16 17-16c1-13 12-23 26-23 12 0 22 7 25 18 3-2 6-2 9-2 10 0 18 8 18 18s-8 18-18 18H26Z" fill="#fffdf6" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
          <path d="M40 62c3-4 8-6 12-4" stroke="#91a98a" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...common} fill="none">
          <circle cx="60" cy="60" r="26" fill="#ffd24a" stroke="#285e63" strokeWidth="4" />
          <g stroke="#285e63" strokeWidth="4" strokeLinecap="round">
            <path d="M60 14v12M60 94v12M14 60h12M94 60h12M27 27l9 9M84 84l9 9M93 27l-9 9M36 84l-9 9" />
          </g>
          <circle cx="52" cy="56" r="3" fill="#285e63" />
          <circle cx="68" cy="56" r="3" fill="#285e63" />
          <path d="M52 68c5 5 11 5 16 0" stroke="#285e63" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )
    case 'squiggle':
      return (
        <svg {...common} fill="none">
          <path d="M8 70c10-18 20-18 30 0s20 18 30 0 20-18 30 0 14 14 22 4" stroke="#f07862" strokeWidth="6" strokeLinecap="round" />
        </svg>
      )
    case 'arrow':
      return (
        <svg {...common} fill="none">
          <path d="M18 34c26-10 48 4 44 26-3 17-26 22-32 8-5-12 12-20 26-14 18 7 26 24 22 42" stroke="#285e63" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 12" />
          <path d="m70 88 8 14 14-9" stroke="#285e63" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'star':
      return (
        <svg {...common} fill="none">
          <path d="m60 12 13 30 33 3-25 22 7 32-28-17-28 17 7-32-25-22 33-3Z" fill="#ffd24a" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
        </svg>
      )
    case 'leaf':
      return (
        <svg {...common} fill="none">
          <path d="M22 98C22 52 52 22 98 22c0 46-30 76-76 76Z" fill="#8ad469" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
          <path d="M22 98 76 44" stroke="#285e63" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )
    case 'rainbow':
      return (
        <svg {...common} fill="none">
          <path d="M14 92a46 46 0 0 1 92 0" stroke="#f07862" strokeWidth="9" strokeLinecap="round" />
          <path d="M27 92a33 33 0 0 1 66 0" stroke="#ffd24a" strokeWidth="9" strokeLinecap="round" />
          <path d="M40 92a20 20 0 0 1 40 0" stroke="#7fd0f5" strokeWidth="9" strokeLinecap="round" />
        </svg>
      )
    case 'fox':
      return (
        <svg {...common} fill="none">
          <path d="M28 44 24 20l22 12Z" fill="#f07862" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
          <path d="M92 44 96 20 74 32Z" fill="#f07862" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
          <path d="M24 46c0 26 16 46 36 46s36-20 36-46c0-16-16-24-36-24S24 30 24 46Z" fill="#f07862" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
          <path d="M38 92c14 10 30 10 44 0-6 12-14 18-22 18s-16-6-22-18Z" fill="#fffdf6" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
          <circle cx="46" cy="50" r="4" fill="#285e63" />
          <circle cx="74" cy="50" r="4" fill="#285e63" />
          <path d="M60 62v6" stroke="#285e63" strokeWidth="4" strokeLinecap="round" />
          <ellipse cx="60" cy="73" rx="8" ry="6" fill="#285e63" />
        </svg>
      )
    case 'rabbit':
      return (
        <svg {...common} fill="none">
          <path d="M42 40c-8-10-10-24-2-28 8-4 14 8 16 20M78 40c8-10 10-24 2-28-8-4-14 8-16 20" fill="#fffdf6" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
          <circle cx="60" cy="72" r="32" fill="#fffdf6" stroke="#285e63" strokeWidth="4" />
          <circle cx="48" cy="68" r="4" fill="#285e63" />
          <circle cx="72" cy="68" r="4" fill="#285e63" />
          <path d="M54 82c4 4 8 4 12 0" stroke="#285e63" strokeWidth="4" strokeLinecap="round" />
          <circle cx="34" cy="82" r="6" fill="#ff9db4" />
          <circle cx="86" cy="82" r="6" fill="#ff9db4" />
        </svg>
      )
    case 'balloon':
      return (
        <svg {...common} fill="none">
          <ellipse cx="60" cy="48" rx="28" ry="32" fill="#7fd0f5" stroke="#285e63" strokeWidth="4" />
          <path d="M60 80v10" stroke="#285e63" strokeWidth="3" strokeLinecap="round" />
          <path d="M60 90c-10 8 10 14 0 24" stroke="#285e63" strokeWidth="3" strokeLinecap="round" />
          <path d="m54 88 6-8 6 8Z" fill="#7fd0f5" stroke="#285e63" strokeWidth="3" strokeLinejoin="round" />
        </svg>
      )
    case 'pencil':
      return (
        <svg {...common} fill="none">
          <path d="m20 100 8-26 52-52 18 18-52 52-26 8Z" fill="#ffd24a" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
          <path d="m80 22 8-8 18 18-8 8Z" fill="#ff9db4" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
          <path d="m28 74 18 18" stroke="#285e63" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )
    case 'heart':
      return (
        <svg {...common} fill="none">
          <path d="M60 100C30 82 14 66 14 46c0-14 11-24 24-24 9 0 17 5 22 13 5-8 13-13 22-13 13 0 24 10 24 24 0 20-16 36-46 54Z" fill="#ff9db4" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
        </svg>
      )
    case 'spiral':
      return (
        <svg {...common} fill="none">
          <path d="M60 60a6 6 0 1 0 6 6 12 12 0 0 0-12-12 20 20 0 0 0-20 20 30 30 0 0 0 30 30 42 42 0 0 0 42-42" stroke="#b39cf5" strokeWidth="5" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg {...common} fill="none">
          <path d="m60 20 10 24 26 3-19 18 5 26-22-13-22 13 5-26-19-18 26-3Z" fill="#ffd24a" stroke="#285e63" strokeWidth="4" strokeLinejoin="round" />
        </svg>
      )
  }
}
