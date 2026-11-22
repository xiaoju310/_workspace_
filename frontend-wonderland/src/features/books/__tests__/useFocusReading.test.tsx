import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as any[], effects: [] as (() => void)[], dirty: false }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: any) => {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = { value: initial }
    return [hooks.slots[i].value, (value: any) => {
      if (!Object.is(hooks.slots[i].value, value)) { hooks.slots[i].value = value; hooks.dirty = true }
    }]
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const i = hooks.cursor++, old = hooks.slots[i]
    if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
      const slot = { deps, cleanup: old?.cleanup }; hooks.slots[i] = slot
      hooks.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() })
    }
  },
}))
import { useFocusReading } from '../useFocusReading'
let scope: string, available: boolean, events: EventTarget
let changed: ReturnType<typeof vi.fn>, value: ReturnType<typeof useFocusReading>
function render() {
  let count = 0
  do {
    hooks.cursor = 0; hooks.dirty = false
    value = useFocusReading(scope, available, changed)
    hooks.effects.splice(0).forEach(effect => effect())
    if (++count > 20) throw new Error('Render loop')
  } while (hooks.dirty)
}
function enter() { value.setActive(true); render(); expect(value.active).toBe(true) }
function key(name = 'Escape', prevented = false) {
  const event = new Event('keydown', { cancelable: true })
  Object.defineProperty(event, 'key', { value: name })
  if (prevented) event.preventDefault()
  events.dispatchEvent(event); render(); return event
}
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = false
  scope = 'demo:book-a'; available = true; changed = vi.fn()
  events = new EventTarget(); vi.stubGlobal('window', events); render()
})
afterEach(() => { hooks.slots.forEach(slot => slot.cleanup?.()); vi.unstubAllGlobals() })
describe('专注阅读会话', () => {
  it('默认关闭，开关同步外层导航且不持久化', () => {
    expect(value.active).toBe(false); expect(changed).toHaveBeenLastCalledWith(false)
    enter(); expect(changed).toHaveBeenLastCalledWith(true)
    value.setActive(false); render(); expect(changed).toHaveBeenLastCalledWith(false)
  })
  it('Esc 退出，其他键不误退出', () => {
    enter(); key('ArrowRight'); expect(value.active).toBe(true)
    expect(key().defaultPrevented).toBe(true); expect(value.active).toBe(false)
    expect(changed).toHaveBeenLastCalledWith(false)
  })
  it('尊重已经处理的 Esc，避免抢走弹层操作', () => { enter(); key('Escape', true); expect(value.active).toBe(true) })
  it.each(['demo:book-b', 'live:alice:book-a'])('书籍或账号切换 %s 自动退出，回到原书不残留', next => {
    enter(); const original = scope; scope = next; render(); expect(value.active).toBe(false)
    scope = original; render(); expect(value.active).toBe(false)
  })
  it('离开阅读页、出错或空书时退出，恢复后须手动开启', () => {
    enter(); available = false; render(); expect(value.active).toBe(false)
    value.setActive(true); render(); expect(value.active).toBe(false)
    available = true; render(); expect(value.active).toBe(false)
  })
  it('卸载恢复外层导航并移除键盘监听', () => {
    enter(); hooks.slots.forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined })
    expect(changed).toHaveBeenLastCalledWith(false)
    expect(key().defaultPrevented).toBe(false)
  })
})
