export interface ReactiveSignal<T> {
  (): T
  set: (value: T) => void
  update: (updater: (prev: T) => T) => void
}

export interface ReadonlyReactiveSignal<T> {
  (): T
}

export class ReactiveStore<TSnapshot = void> {
  private readonly listeners = new Set<() => void>()
  private cachedSnapshot: TSnapshot | null = null
  private hasSnapshot = false

  protected notify(): void {
    this.hasSnapshot = false
    this.cachedSnapshot = null
    for (const listener of this.listeners) {
      listener()
    }
  }

  protected signal<T>(initialValue: T): ReactiveSignal<T> {
    let current = initialValue
    const fn = (() => current) as ReactiveSignal<T>
    fn.set = (next: T) => {
      if (Object.is(current, next)) return
      current = next
      this.notify()
    }
    fn.update = (updater: (prev: T) => T) => {
      const next = updater(current)
      if (Object.is(current, next)) return
      current = next
      this.notify()
    }
    return fn
  }

  protected computed<T>(compute: () => T): ReadonlyReactiveSignal<T> {
    return () => compute()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  protected buildSnapshot(): TSnapshot {
    return undefined as TSnapshot
  }

  getSnapshot = (): TSnapshot => {
    if (!this.hasSnapshot) {
      this.cachedSnapshot = this.buildSnapshot()
      this.hasSnapshot = true
    }
    return this.cachedSnapshot as TSnapshot
  }
}
