/**
 * Bundle Monaco with the app instead of loading it from a CDN at runtime, so
 * the INP editor works offline and the version is pinned by package-lock.
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

const g = self as unknown as { MonacoEnvironment?: { getWorker: () => Worker } }
g.MonacoEnvironment = { getWorker: () => new EditorWorker() }

loader.config({ monaco })
