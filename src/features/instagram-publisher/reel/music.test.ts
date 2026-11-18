/** The rotation and the excerpt, on synthetic audio (an ffmpeg click track at a known BPM), never the real music. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run, mediaBin } from '../runtime.ts'
import { nextTrack, readTracks, readyTrack, writeExcerpt, type Track } from './music.ts'

const track = (id: string): Track => ({ id, title: id, artist: 'x', file: `${id}.flac`, durationSec: 10, bpm: 90, startSec: 0, credit: null })

describe('rotation', () => {
  it('picks never-published tracks first in tracks.json order, then the oldest last publish', () => {
    const tracks = ['a', 'b', 'c'].map(track)
    expect(nextTrack(tracks, []).id).toBe('a')
    expect(nextTrack(tracks, [{ track: 'a', from: '2026-11-20' }]).id).toBe('b')
    expect(nextTrack(tracks, [{ track: 'a', from: '2026-11-20' }, { track: 'b', from: '2026-11-27' }, { track: 'c', from: '2026-11-13' }]).id).toBe('c')
    expect(nextTrack(tracks, [{ track: 'a', from: '2026-11-06' }, { track: 'a', from: '2026-12-04' }, { track: 'b', from: '2026-11-27' }, { track: 'c', from: '2026-11-13' }]).id).toBe('c')
  })

  it('reads the per-track shape and fails closed on an unmeasured track', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reel-music-'))
    writeFileSync(join(dir, 'tracks.json'), JSON.stringify({ tracks: [{ ...track('a'), license: 'synthetic' }, { ...track('b'), bpm: null }] }))
    writeFileSync(join(dir, 'a.flac'), '')
    expect(readTracks(dir).map(t => t.id)).toEqual(['a', 'b'])
    expect(readyTrack(dir, 'a').path).toBe(join(dir, 'a.flac'))
    expect(() => readyTrack(dir, 'b')).toThrow(/no bpm and startSec/)
    expect(() => readyTrack(dir, 'z')).toThrow(/not in/)
  })
})

const ffmpeg = (() => { try { return mediaBin('ffmpeg') } catch { return null } })()

describe.skipIf(!ffmpeg)('excerpt', () => {
  const exec = (argv: string[]) => run([mediaBin(argv[0] as 'ffmpeg' | 'ffprobe'), ...argv.slice(1)], 60_000)
  // 12 s click track at 120 BPM: a 1 kHz blip every 0.5 s over a steady 220 Hz tone and quiet noise.
  const dir = mkdtempSync(join(tmpdir(), 'reel-click-'))
  const src = join(dir, 'click.flac')
  if (ffmpeg) spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='0.2*sin(2*PI*220*t)+if(lt(mod(t,0.5),0.03),0.5*sin(2*PI*1000*t),0)':s=48000:d=12", '-f', 'lavfi', '-i', 'anoisesrc=d=12:a=0.01:r=48000', '-filter_complex', 'amix=inputs=2:normalize=0', src])

  it('cuts from startSec, fades, and normalizes to about −14 LUFS', async () => {
    const out = join(dir, 'x.wav')
    await writeExcerpt(exec, src, 2, 8, out)
    const probe = await exec(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,channels', '-of', 'json', out])
    const info = JSON.parse(probe.out)
    expect(Number(info.format.duration)).toBeCloseTo(8, 1)
    expect(info.streams[0]).toMatchObject({ sample_rate: '48000', channels: 2 })
    const loud = await exec(['ffmpeg', '-hide_banner', '-nostats', '-i', out, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
    const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(loud.err.slice(loud.err.lastIndexOf('Summary')))![1])
    expect(Math.abs(integrated + 14)).toBeLessThan(1)
  }, 60_000)

  it('refuses an excerpt that runs past the end', async () => {
    await expect(writeExcerpt(exec, src, 6, 8, join(dir, 'y.wav'))).rejects.toThrow(/music runs out/)
  }, 60_000)
})

describe('credits', () => {
  it('fails closed on a CC BY track without a credit, and accepts null credit for other licenses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reel-credit-'))
    writeFileSync(join(dir, 'tracks.json'), JSON.stringify({ tracks: [
      { ...track('cc'), license: 'CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/)', credit: '  ' },
      { ...track('ok'), license: 'CC BY 3.0', credit: 'Música: "x" de y, CC BY 3.0.' },
      { ...track('meta'), license: 'Meta Sound Collection Terms', credit: null },
    ] }))
    for (const id of ['cc', 'ok', 'meta']) writeFileSync(join(dir, `${id}.flac`), '')
    expect(() => readyTrack(dir, 'cc')).toThrow(/CC BY license but no credit/)
    expect(readyTrack(dir, 'ok').credit).toContain('CC BY')
    expect(readyTrack(dir, 'meta').credit).toBeNull()
  })
})
