import { spiral, ViewRect, chunkPos } from './simpleUtils'
import { Vec3 } from 'vec3'
import { EventEmitter } from 'events'

export type ChunkPosKey = string

/**
 * Usually connects to mineflayer bot and emits world data (chunks, entities)
 * It's up to the consumer to serialize the data if needed
 */
export class WorldDataEmitter extends EventEmitter {
  private loadedChunks: Record<ChunkPosKey, boolean>
  private lastPos: Vec3
  private eventListeners: Record<string, any> = {};
  private emitter: WorldDataEmitter

  constructor(public world: import('prismarine-world').world.World, public viewDistance: number, position: Vec3 = new Vec3(0, 0, 0)) {
    super()
    this.world = world
    this.loadedChunks = {}
    this.lastPos = new Vec3(0, 0, 0).update(position)
    this.emitter = this

    this.emitter.on('mouseClick', async (click) => {
      const ori = new Vec3(click.origin.x, click.origin.y, click.origin.z)
      const dir = new Vec3(click.direction.x, click.direction.y, click.direction.z)
      const block = this.world.raycast(ori, dir, 256)
      if (!block) return
      //@ts-ignore
      this.emit('blockClicked', block, block.face, click.button)
    })
  }

  listenToBot (bot: import('mineflayer').Bot) {
    this.eventListeners[bot.username] = {
      // 'move': botPosition,
      entitySpawn: (e: any) => {
        if (e === bot.entity) return
        this.emitter.emit('entity', { id: e.id, name: e.name, pos: e.position, width: e.width, height: e.height, username: e.username })
      },
      entityMoved: (e: any) => {
        this.emitter.emit('entity', { id: e.id, pos: e.position, pitch: e.pitch, yaw: e.yaw })
      },
      entityGone: (e: any) => {
        this.emitter.emit('entity', { id: e.id, delete: true })
      },
      chunkColumnLoad: (pos: Vec3) => {
        this.loadChunk(pos)
      },
      blockUpdate: (oldBlock: any, newBlock: any) => {
        const stateId = newBlock.stateId ? newBlock.stateId : ((newBlock.type << 4) | newBlock.metadata)
        this.emitter.emit('blockUpdate', { pos: oldBlock.position, stateId })
      }
    }

    for (const [evt, listener] of Object.entries(this.eventListeners[bot.username])) {
      bot.on(evt as any, listener)
    }

    for (const id in bot.entities) {
      const e = bot.entities[id]
      if (e && e !== bot.entity) {
        this.emitter.emit('entity', { id: e.id, name: e.name, pos: e.position, width: e.width, height: e.height, username: e.username })
      }
    }
  }

  removeListenersFromBot (bot: import('mineflayer').Bot) {
    for (const [evt, listener] of Object.entries(this.eventListeners[bot.username])) {
      bot.removeListener(evt as any, listener)
    }
    delete this.eventListeners[bot.username]
  }

  async init (pos: Vec3) {
    const [botX, botZ] = chunkPos(pos)

    const positions: Vec3[] = []
    spiral(this.viewDistance * 2, this.viewDistance * 2, (x, z) => {
      const p = new Vec3((botX + x) * 16, 0, (botZ + z) * 16)
      positions.push(p)
    })

    this.lastPos.update(pos)
    await this._loadChunks(positions)
  }

  async _loadChunks (positions: Vec3[], sliceSize = 5, waitTime = 0) {
    for (let i = 0; i < positions.length; i += sliceSize) {
      await new Promise((resolve) => setTimeout(resolve, waitTime))
      await Promise.all(positions.slice(i, i + sliceSize).map((p) => this.loadChunk(p)))
    }
  }

  async loadChunk (pos: Vec3) {
    const [botX, botZ] = chunkPos(this.lastPos)
    const dx = Math.abs(botX - Math.floor(pos.x / 16))
    const dz = Math.abs(botZ - Math.floor(pos.z / 16))
    if (dx < this.viewDistance && dz < this.viewDistance) {
      const column = await this.world.getColumnAt(pos)
      if (column) {
        // todo optimize toJson data, make it clear why it is used
        const chunk = column.toJson()
        // TODO: blockEntities
        //@ts-ignore
        this.emitter.emit('loadChunk', { x: pos.x, z: pos.z, chunk, blockEntities: column.blockEntities })
        this.loadedChunks[`${pos.x},${pos.z}`] = true
      }
    }
  }

  unloadChunk (pos: Vec3) {
    this.emitter.emit('unloadChunk', { x: pos.x, z: pos.z })
    delete this.loadedChunks[`${pos.x},${pos.z}`]
  }

  async updatePosition (pos: Vec3, force = false) {
    const [lastX, lastZ] = chunkPos(this.lastPos)
    const [botX, botZ] = chunkPos(pos)
    if (lastX !== botX || lastZ !== botZ || force) {
      const newView = new ViewRect(botX, botZ, this.viewDistance)
      for (const coords of Object.keys(this.loadedChunks)) {
        const x = parseInt(coords.split(',')[0])
        const z = parseInt(coords.split(',')[1])
        const p = new Vec3(x, 0, z)
        if (!newView.contains(Math.floor(x / 16), Math.floor(z / 16))) {
          this.unloadChunk(p)
        }
      }
      const positions: Vec3[] = []
      spiral(this.viewDistance * 2, this.viewDistance * 2, (x, z) => {
        const p = new Vec3((botX + x) * 16, 0, (botZ + z) * 16)
        if (!this.loadedChunks[`${p.x},${p.z}`]) {
          positions.push(p)
        }
      })
      this.lastPos.update(pos)
      await this._loadChunks(positions)
    } else {
      this.lastPos.update(pos)
    }
  }
}