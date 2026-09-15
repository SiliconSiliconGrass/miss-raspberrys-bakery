import randint from "@/utils/random/randint";

import GameState from "./GameState";
import Piece from "./Piece";
import FixedConstraint from "./FixedConstraint";


interface Coord {
    x: number
    y: number
}

/** A group is a maximal region of blocks which touch each other and share the same type. */
interface Group {
    typeId: number
    blocks: Coord[]
}


/** Fisher-Yates shuffle. Returns a new array, the argument is not modified. */
function shuffle<T>(array: T[]): T[] {
    const result = [...array]
    for (let i = result.length - 1; i > 0; i--) {
        const j = randint(0, i)
        const tmp = result[i]!
        result[i] = result[j]!
        result[j] = tmp
    }
    return result
}


export default class QuizGenerator {

    numRows: number
    numCols: number
    numTypes: number

    /** The assembled picture of the last generated quiz. `0` is empty, otherwise a type id. */
    _answer: number[][]

    constructor(numRows?: number, numCols?: number, numTypes?: number) {
        this.numRows = Math.max(1, Math.floor(numRows ?? randint(5, 8)))
        this.numCols = Math.max(1, Math.floor(numCols ?? randint(5, 8)))
        this.numTypes = Math.max(1, Math.floor(numTypes ?? 1))

        this._answer = []
    }


    /** The assembled picture of the last generated quiz, `_answer[y][x]`. */
    getAnswer() {
        return this._answer
    }


    generate(): GameState {
        // 1. randomly generate the assembled picture
        const answer = this.generateAnswer()
        this._answer = answer

        // 2. find all the groups (continuous region which is filled with a single type)
        const groups = this.findGroups(answer)

        // 3. cut every group into pieces: the pieces start from random seed blocks, and
        // then they grow until they cover the whole group
        const pieces: Piece[] = []
        for (let group of groups) {
            pieces.push(...this.cutGroupIntoPieces(group))
        }

        // 4. organize the result as the initial game state
        const {rowDemands, colDemands} = this.computeDemands(answer)
        const fixed: FixedConstraint[] = []

        return new GameState(
            this.numRows,
            this.numCols,
            this.numTypes,
            rowDemands,
            colDemands,
            // shuffle the pieces, otherwise the order of the pieces gives away the answer
            shuffle(pieces),
            fixed
        )
    }


    private generateAnswer(): number[][] {
        const numRows = this.numRows
        const numCols = this.numCols
        const matrix: number[][] = Array.from({ length: numRows }, () => Array(numCols).fill(0))

        // place some random dominoes ("|" or "—") instead of single blocks:
        // this is a simple strategy to avoid lonely blocks in the picture
        const numStrokes = randint(
            Math.max(2, Math.ceil(numRows * numCols / 8)),
            Math.max(4, Math.ceil(numRows * numCols / 4))
        )
        for (let i = 0; i < numStrokes; i++) {
            const typeId = randint(1, this.numTypes)

            const directions: ("|" | "—")[] = []
            if (numRows >= 2) {
                directions.push("|")
            }
            if (numCols >= 2) {
                directions.push("—")
            }
            if (directions.length === 0) {
                // 1x1 board, there is no room for a domino
                matrix[0]![0] = typeId
                continue
            }

            const direction = directions[randint(0, directions.length - 1)]
            if (direction === "|") {
                const x = randint(0, numCols - 1)
                const y = randint(0, numRows - 2)
                matrix[y]![x] = typeId
                matrix[y + 1]![x] = typeId
            } else {
                const x = randint(0, numCols - 2)
                const y = randint(0, numRows - 1)
                matrix[y]![x] = typeId
                matrix[y]![x + 1] = typeId
            }
        }

        // the picture should have at least one kind of symmetry
        this.applySymmetry(matrix, randint(0, 1))

        // the picture is never empty
        const numBlocks = matrix.reduce((sum, row) => sum + row.filter(typeId => typeId !== 0).length, 0)
        if (numBlocks === 0) {
            matrix[randint(0, numRows - 1)]![randint(0, numCols - 1)] = randint(1, this.numTypes)
        }

        return matrix
    }


    /** Copy every block of the picture to the block it is symmetric with. */
    private applySymmetry(matrix: number[][], symmetricType: number) {
        const numRows = this.numRows
        const numCols = this.numCols

        for (let y = 0; y < numRows; y++) {
            for (let x = 0; x < numCols; x++) {
                const typeId = matrix[y]![x]!
                if (typeId === 0) {
                    continue
                }
                if (symmetricType === 0) {
                    // left-right symmetric
                    matrix[y]![numCols - x - 1] = typeId
                } else {
                    // top-bottom symmetric
                    matrix[numRows - y - 1]![x] = typeId
                }
            }
        }
    }


    /** Flood fill the blocks of the picture to find the groups it is made of. */
    private findGroups(matrix: number[][]): Group[] {
        const numRows = this.numRows
        const numCols = this.numCols

        const groupIndOfBlock: number[][] = Array.from({ length: numRows }, () => Array(numCols).fill(-1))
        const groups: Group[] = []

        for (let y = 0; y < numRows; y++) {
            for (let x = 0; x < numCols; x++) {
                const typeId = matrix[y]![x]!
                if (typeId === 0 || groupIndOfBlock[y]![x] !== -1) {
                    continue
                }

                // a new group: flood fill all the blocks which are connected to this one
                const groupInd = groups.length
                const blocks: Coord[] = []
                const queue: Coord[] = [{x, y}]
                groupIndOfBlock[y]![x] = groupInd
                while (queue.length > 0) {
                    const block = queue.pop()!
                    blocks.push(block)
                    for (let neighbor of this.getNeighbors(block)) {
                        if (groupIndOfBlock[neighbor.y]![neighbor.x] !== -1) {
                            continue
                        }
                        if (matrix[neighbor.y]![neighbor.x] !== typeId) {
                            continue
                        }
                        groupIndOfBlock[neighbor.y]![neighbor.x] = groupInd
                        queue.push(neighbor)
                    }
                }

                groups.push({typeId, blocks})
            }
        }

        return groups
    }


    /**
     * Cut a single group into pieces.
     *
     * Some random blocks of the group are picked as seeds, every seed starts a piece,
     * and then all the pieces grow at the same time until the group is fully covered.
     * A piece only grows on the blocks of its own group, so a piece never leaves its
     * group and every piece stays a continuous chunk of blocks.
     */
    private cutGroupIntoPieces(group: Group): Piece[] {
        const blocks = group.blocks

        // one piece is about 3~6 blocks large
        const avgPieceSize = randint(3, 6)
        const numSeeds = Math.max(1, Math.min(blocks.length, Math.round(blocks.length / avgPieceSize)))

        // randomly pick the seed blocks of the pieces
        const seeds = shuffle(blocks).slice(0, numSeeds)

        const pieceIndOfBlock = new Map<number, number>() // blockId -> piece index
        const pieceBlocks: Coord[][] = seeds.map(seed => [seed])
        seeds.forEach((seed, pieceInd) => pieceIndOfBlock.set(this.getBlockId(seed), pieceInd))

        // the blocks of the group which are not part of a piece yet
        const restBlocks = blocks.filter(block => !pieceIndOfBlock.has(this.getBlockId(block)))

        while (restBlocks.length > 0) {
            // every free block which touches a piece is a growth candidate
            const candidates: {blockInd: number, pieceInds: number[]}[] = []
            for (let blockInd = 0; blockInd < restBlocks.length; blockInd++) {
                const pieceInds: number[] = []
                for (let neighbor of this.getNeighbors(restBlocks[blockInd]!)) {
                    const pieceInd = pieceIndOfBlock.get(this.getBlockId(neighbor))
                    if (pieceInd !== undefined && !pieceInds.includes(pieceInd)) {
                        pieceInds.push(pieceInd)
                    }
                }
                if (pieceInds.length > 0) {
                    candidates.push({blockInd, pieceInds: shuffle(pieceInds)})
                }
            }

            if (candidates.length === 0) {
                // cannot happen: a group is continuous by definition
                break
            }

            const candidate = candidates[randint(0, candidates.length - 1)]!
            // the smallest piece grows first, so that all the pieces end up similar in size
            const pieceInd = candidate.pieceInds.reduce((smallestPieceInd, pieceInd) =>
                pieceBlocks[pieceInd]!.length < pieceBlocks[smallestPieceInd]!.length ? pieceInd : smallestPieceInd
            )

            const block = restBlocks[candidate.blockInd]!
            pieceIndOfBlock.set(this.getBlockId(block), pieceInd)
            pieceBlocks[pieceInd]!.push(block)
            restBlocks.splice(candidate.blockInd, 1)
        }

        return pieceBlocks.map(blocks => this.toPiece(group.typeId, blocks))
    }


    /** Convert the blocks of a piece into a `Piece`, with a relative shape matrix. */
    private toPiece(typeId: number, blocks: Coord[]): Piece {
        const minX = Math.min(...blocks.map(block => block.x))
        const maxX = Math.max(...blocks.map(block => block.x))
        const minY = Math.min(...blocks.map(block => block.y))
        const maxY = Math.max(...blocks.map(block => block.y))

        const shape: number[][] = Array.from(
            { length: maxY - minY + 1 },
            () => Array(maxX - minX + 1).fill(0)
        )
        for (let block of blocks) {
            shape[block.y - minY]![block.x - minX] = 1
        }

        return new Piece(typeId, shape)
    }


    /**
     * Count, for every row and every column, how many blocks of each type the picture
     * contains: `rowDemands[rowInd][typeInd]` and `colDemands[colInd][typeInd]`, where
     * `typeInd` is `typeId - 1`.
     */
    private computeDemands(matrix: number[][]) {
        const rowDemands: number[][] = Array.from({ length: this.numRows }, () => Array(this.numTypes).fill(0))
        const colDemands: number[][] = Array.from({ length: this.numCols }, () => Array(this.numTypes).fill(0))

        for (let y = 0; y < this.numRows; y++) {
            for (let x = 0; x < this.numCols; x++) {
                const typeId = matrix[y]![x]!
                if (typeId === 0) {
                    continue
                }
                rowDemands[y]![typeId - 1]!++
                colDemands[x]![typeId - 1]!++
            }
        }

        return {rowDemands, colDemands}
    }


    private getNeighbors(block: Coord): Coord[] {
        const neighbors: Coord[] = [
            {x: block.x + 1, y: block.y},
            {x: block.x - 1, y: block.y},
            {x: block.x, y: block.y + 1},
            {x: block.x, y: block.y - 1},
        ]
        return neighbors.filter(neighbor =>
            neighbor.x >= 0 && neighbor.x < this.numCols && neighbor.y >= 0 && neighbor.y < this.numRows
        )
    }


    private getBlockId(block: Coord) {
        return block.y * this.numCols + block.x
    }

}
