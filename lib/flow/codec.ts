/**
 * A small, exact ABI codec for the calls this page makes.
 *
 * The contracts are compiled with `evm_version = "shanghai"` and the console
 * already talks to the node over plain JSON-RPC, so a full client library would
 * be another dependency for six call shapes. What is implemented here is the
 * subset of the spec those shapes use: static words, `bytes`, `bytes[]`, and
 * tuples — including a tuple with a dynamic member, which is exactly what
 * `ITitleVerifier.TitleProof` is.
 */

export type AbiParameter = {
  readonly name?: string
  readonly type: string
  readonly internalType?: string
  readonly indexed?: boolean
  readonly components?: readonly AbiParameter[]
}

export type AbiFunction = {
  readonly type: 'function'
  readonly name: string
  readonly inputs: readonly AbiParameter[]
  readonly outputs: readonly AbiParameter[]
  readonly stateMutability: string
  readonly signature: string
  readonly selector: string
}

export type AbiError = {
  readonly type: 'error'
  readonly name: string
  readonly inputs: readonly AbiParameter[]
  readonly signature: string
  readonly selector: string
}

export type AbiEvent = {
  readonly type: 'event'
  readonly name: string
  readonly anonymous?: boolean
  readonly inputs?: readonly AbiParameter[]
}

export type AbiEntry = AbiFunction | AbiError | AbiEvent

export type CallArgument = bigint | number | string | boolean | readonly unknown[]

const WORD = 64

function stripHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
}

function bytesToHex(value: Uint8Array): string {
  let out = ''
  for (const byte of value) out += byte.toString(16).padStart(2, '0')
  return out
}

function hexToBytes(value: string): Uint8Array {
  const body = stripHex(value)
  if (body.length % 2 !== 0) throw new Error('odd length hex')
  const out = new Uint8Array(body.length / 2)
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16)
  }
  return out
}

function word(value: string): string {
  if (value.length > WORD) throw new Error('value does not fit one word')
  return value.padStart(WORD, '0')
}

function padRight(value: string): string {
  const remainder = value.length % WORD
  return remainder === 0 ? value : value + '0'.repeat(WORD - remainder)
}

export function isDynamic(param: AbiParameter): boolean {
  const type = param.type
  if (type === 'bytes' || type === 'string') return true
  if (type.endsWith('[]')) return true
  if (type.startsWith('tuple')) return (param.components ?? []).some(isDynamic)
  return false
}

function encodeStatic(param: AbiParameter, value: CallArgument): string {
  const type = param.type

  if (type.startsWith('tuple')) {
    return encodeSequence(param.components ?? [], value as readonly CallArgument[])
  }

  if (type === 'address') {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`${param.name ?? 'address'} must be a 20 byte hex address`)
    }
    return word(stripHex(value).toLowerCase())
  }

  if (type === 'bool') {
    return word(value === true ? '1' : '0')
  }

  if (type.startsWith('uint') || type.startsWith('int')) {
    const parsed = BigInt(value as bigint | number | string)
    if (parsed < 0n) throw new Error(`${param.name ?? 'value'} is negative`)
    return word(parsed.toString(16))
  }

  if (type.startsWith('bytes')) {
    const body = stripHex(String(value))
    const size = Number.parseInt(type.slice(5), 10)
    if (body.length !== size * 2) {
      throw new Error(`${param.name ?? type} needs exactly ${size} bytes`)
    }
    return padRight(body.toLowerCase())
  }

  throw new Error(`cannot encode ${type}`)
}

function encodeDynamic(param: AbiParameter, value: CallArgument): string {
  const type = param.type

  if (type === 'bytes') {
    const body = stripHex(String(value))
    return word((body.length / 2).toString(16)) + padRight(body.toLowerCase())
  }

  if (type === 'string') {
    const body = bytesToHex(new TextEncoder().encode(String(value)))
    return word((body.length / 2).toString(16)) + padRight(body)
  }

  if (type === 'bytes[]') {
    const items = value as readonly string[]
    const headSize = items.length * 32
    let tail = ''
    const offsets: string[] = []
    for (const item of items) {
      offsets.push(word((headSize + tail.length / 2).toString(16)))
      tail += encodeDynamic({ type: 'bytes' }, item)
    }
    return word(items.length.toString(16)) + offsets.join('') + tail
  }

  if (type.startsWith('tuple')) {
    return encodeSequence(param.components ?? [], value as readonly CallArgument[])
  }

  throw new Error(`cannot encode dynamic ${type}`)
}

/** The encoding of a tuple: heads, then tails, with offsets from its start. */
function encodeSequence(
  params: readonly AbiParameter[],
  values: readonly CallArgument[],
): string {
  if (params.length !== values.length) {
    throw new Error(`expected ${params.length} arguments, got ${values.length}`)
  }

  const headSize = params.length * 32
  const heads: string[] = []
  let tail = ''

  params.forEach((param, index) => {
    const value = values[index] as CallArgument
    if (isDynamic(param)) {
      heads.push(word((headSize + tail.length / 2).toString(16)))
      tail += encodeDynamic(param, value)
      return
    }
    heads.push(encodeStatic(param, value))
  })

  return heads.join('') + tail
}

/** Calldata for one function: its selector followed by the encoded arguments. */
export function encodeFunctionCall(
  fn: AbiFunction,
  args: readonly CallArgument[] = [],
): string {
  return `${fn.selector}${encodeSequence(fn.inputs, args)}`
}

function readWordAt(body: string, byteOffset: number): string {
  return body.slice(byteOffset * 2, byteOffset * 2 + WORD).padEnd(WORD, '0')
}

function decodeStatic(
  param: AbiParameter,
  body: string,
  byteOffset: number,
): { value: unknown; words: number } {
  const type = param.type

  if (type.startsWith('tuple')) {
    const components = param.components ?? []
    const values: unknown[] = []
    let offset = byteOffset
    for (const component of components) {
      const decoded = decodeStatic(component, body, offset)
      values.push(decoded.value)
      offset += decoded.words * 32
    }
    return { value: values, words: components.length }
  }

  const raw = readWordAt(body, byteOffset)

  if (type === 'address') return { value: `0x${raw.slice(24).toLowerCase()}`, words: 1 }
  if (type === 'bool') return { value: BigInt(`0x${raw}`) !== 0n, words: 1 }
  if (type.startsWith('uint') || type.startsWith('int')) {
    return { value: BigInt(`0x${raw}`), words: 1 }
  }
  if (type.startsWith('bytes')) {
    const size = Number.parseInt(type.slice(5), 10)
    return { value: `0x${raw.slice(0, size * 2)}`, words: 1 }
  }

  throw new Error(`cannot decode ${type}`)
}

function decodeDynamic(param: AbiParameter, body: string, byteOffset: number): unknown {
  const type = param.type

  if (type === 'bytes' || type === 'string') {
    const length = Number(BigInt(`0x${readWordAt(body, byteOffset)}`))
    const start = (byteOffset + 32) * 2
    const raw = body.slice(start, start + length * 2)
    if (type === 'string') {
      const bytes = hexToBytes(raw)
      return new TextDecoder().decode(bytes)
    }
    return `0x${raw.toLowerCase()}`
  }

  if (type === 'bytes[]') {
    const count = Number(BigInt(`0x${readWordAt(body, byteOffset)}`))
    const items: string[] = []
    for (let index = 0; index < count; index += 1) {
      const pointer = Number(BigInt(`0x${readWordAt(body, byteOffset + 32 + index * 32)}`))
      items.push(decodeDynamic({ type: 'bytes' }, body, byteOffset + 32 + pointer) as string)
    }
    return items
  }

  if (type.startsWith('tuple')) {
    return decodeSequence(param.components ?? [], body.slice(byteOffset * 2))
  }

  throw new Error(`cannot decode dynamic ${type}`)
}

function decodeSequence(params: readonly AbiParameter[], body: string): unknown[] {
  const values: unknown[] = []
  let cursor = 0

  for (const param of params) {
    if (isDynamic(param)) {
      const pointer = Number(BigInt('0x' + readWordAt(body, cursor * 32)))
      values.push(decodeDynamic(param, body, pointer))
      cursor += 1
      continue
    }

    const decoded = decodeStatic(param, body, cursor * 32)
    values.push(decoded.value)
    cursor += decoded.words
  }

  return values
}

/** Decodes a returned payload against the function's declared outputs. */
export function decodeFunctionResult(
  fn: AbiFunction,
  payload: string,
): readonly unknown[] {
  const body = stripHex(payload)
  if (body.length === 0) {
    throw new Error(
      `${fn.name} returned nothing: the address holds no contract code, or the call was not executed`,
    )
  }
  return decodeSequence(fn.outputs, body)
}

/** Decodes a custom error's arguments from its revert payload. */
export function decodeErrorArguments(
  error: AbiError,
  payload: string,
): readonly unknown[] {
  const body = stripHex(payload).slice(8)
  if (body.length === 0) return []
  return decodeSequence(error.inputs, body)
}

/* ---- token amounts ------------------------------------------------------ */

/** Planck / wei style scaling with no floating point in the path. */
export function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString()

  const negative = value < 0n
  const absolute = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = absolute / base
  const fraction = (absolute % base).toString().padStart(decimals, '0').replace(/0+$/, '')

  return `${negative ? '-' : ''}${whole.toString()}${fraction.length > 0 ? `.${fraction}` : ''}`
}

/** Parses a decimal string exactly, or returns null when it is not a number. */
export function parseUnits(value: string, decimals: number): bigint | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null

  const [whole, fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) return null

  const padded = fraction.padEnd(decimals, '0')
  return BigInt(`${whole ?? '0'}${padded}`)
}

export { hexToBytes, bytesToHex, stripHex }
