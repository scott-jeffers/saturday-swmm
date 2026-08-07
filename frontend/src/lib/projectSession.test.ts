import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearStoredProjectPath,
  readStoredProjectPath,
  writeStoredProjectPath,
} from './projectSession'

const KEY = 'saturday-swmm-active-project'

function installSessionStorageMock() {
  const store = new Map<string, string>()
  const mock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  }
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: mock,
  })
  return store
}

beforeEach(() => {
  installSessionStorageMock()
})

afterEach(() => {
  sessionStorage.removeItem(KEY)
})

describe('projectSession', () => {
  it('returns null when nothing stored', () => {
    expect(readStoredProjectPath()).toBeNull()
  })

  it('writes and reads a project path', () => {
    writeStoredProjectPath('C:\\Users\\me\\projects\\demo')
    expect(readStoredProjectPath()).toBe('C:\\Users\\me\\projects\\demo')
  })

  it('trims whitespace on write and read', () => {
    writeStoredProjectPath('  /tmp/model  ')
    expect(readStoredProjectPath()).toBe('/tmp/model')
  })

  it('clears stored path', () => {
    writeStoredProjectPath('/tmp/model')
    clearStoredProjectPath()
    expect(readStoredProjectPath()).toBeNull()
  })

  it('write of empty string clears storage', () => {
    writeStoredProjectPath('/tmp/model')
    writeStoredProjectPath('   ')
    expect(readStoredProjectPath()).toBeNull()
  })
})
