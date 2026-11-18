/**
 * The Reel's music: the track list in the music directory (outside the repo, never committed), the rotation, and the
 * excerpt (from `startSec`, 0.3 s fade in, 1.0 s fade out, two-pass loudnorm to −14 LUFS and −1.5 dBTP, as in v2).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Track {
  id: string
  title: string
  artist: string
  file: string
  durationSec: number
  bpm: number | null
  startSec: number | null
  /** A caption credit line, when the license needs one. */
  credit: string | null
}

/** A track ready for a Reel: measured, with its audio file. */
export type ReadyTrack = Track & { bpm: number; startSec: number; path: string }

/** What a draft saves about its track. */
export type DraftTrack = Pick<Track, 'id' | 'title' | 'artist' | 'credit'>

export function readTracks(dir: string): Track[] {
  const file = join(dir, 'tracks.json')
  if (!existsSync(file)) throw new Error(`No Reel music: ${file} is missing (config reel.musicDir)`)
  const tracks = JSON.parse(readFileSync(file, 'utf8'))?.tracks
  if (!Array.isArray(tracks) || !tracks.length) throw new Error(`${file} has no tracks`)
  for (const track of tracks) {
    if (typeof track?.id !== 'string' || typeof track.file !== 'string' || typeof track.title !== 'string' || typeof track.artist !== 'string') {
      throw new Error(`${file}: every track needs id, title, artist, and file`)
    }
  }
  return tracks.map(track => ({ ...track, credit: track.credit ?? null, bpm: track.bpm ?? null, startSec: track.startSec ?? null }))
}

/** The track whose last published Reel is oldest; tracks never published come first, in tracks.json order. */
export function nextTrack(tracks: Track[], published: Array<{ track: string; from: string }>): Track {
  const last = new Map<string, string>()
  for (const reel of published) if ((last.get(reel.track) ?? '') < reel.from) last.set(reel.track, reel.from)
  // Stable sort keeps tracks.json order among equals; '' (never published) sorts first.
  return [...tracks].sort((a, b) => (last.get(a.id) ?? '').localeCompare(last.get(b.id) ?? ''))[0]!
}

/** Fail closed: a Reel never goes out without its music. */
export function readyTrack(dir: string, id: string): ReadyTrack {
  const track = readTracks(dir).find(candidate => candidate.id === id)
  if (!track) throw new Error(`Reel track ${id} is not in ${join(dir, 'tracks.json')}`)
  if (typeof track.bpm !== 'number' || typeof track.startSec !== 'number') {
    throw new Error(`Reel track ${id} has no bpm and startSec yet; measure it and fill them in ${join(dir, 'tracks.json')}`)
  }
  const path = join(dir, track.file)
  if (!existsSync(path)) throw new Error(`Reel track ${id}: ${path} is missing`)
  return { ...track, bpm: track.bpm, startSec: track.startSec, path }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000

/** The excerpt's filter chain before loudnorm. */
export const excerptFilter = (startSec: number, total: number) =>
  `atrim=start=${startSec.toFixed(4)}:duration=${total},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.3,afade=t=out:st=${r3(total - 1)}:d=1`

export type Exec = (argv: string[]) => Promise<{ out: string; err: string; code: number | null }>

/**
 * Write the excerpt of `src` from `startSec`, `total` seconds long, faded and loudness-normalized, to `out`. `codec`
 * picks the output encoding (WAV for the render, MP3 for a listening copy). Refuses an excerpt that runs past the end.
 */
export async function writeExcerpt(exec: Exec, src: string, startSec: number, total: number, out: string, codec: string[] = ['-c:a', 'pcm_s16le']) {
  const probe = await exec(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src])
  const duration = Number(probe.out.trim())
  if (probe.code !== 0 || !Number.isFinite(duration)) throw new Error(`ffprobe couldn't read ${src}: ${probe.err.trim().slice(0, 200)}`)
  if (startSec + total > duration) throw new Error(`The music runs out: ${startSec} + ${total} s is past the track's end at ${duration} s`)
  const pre = excerptFilter(startSec, total)
  const pass1 = await exec(['ffmpeg', '-hide_banner', '-nostats', '-i', src, '-af', `${pre},loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'])
  if (pass1.code !== 0) throw new Error(`ffmpeg loudness pass failed: ${pass1.err.trim().slice(-300)}`)
  const m = JSON.parse(pass1.err.slice(pass1.err.lastIndexOf('{'), pass1.err.lastIndexOf('}') + 1))
  const norm = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  const pass2 = await exec(['ffmpeg', '-hide_banner', '-nostats', '-y', '-i', src, '-af', `${pre},${norm}`, '-ar', '48000', '-ac', '2', ...codec, out])
  if (pass2.code !== 0) throw new Error(`ffmpeg excerpt failed: ${pass2.err.trim().slice(-300)}`)
}
