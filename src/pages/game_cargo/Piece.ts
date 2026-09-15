/** A block of the board: `row` counts from the top, `col` from the left. */
export interface BoardCell {
    row: number
    col: number
}


export default class Piece {

    typeId: number
    width: number
    height: number
    /**
     * Column of the top-left corner of the piece on the board.
     * `-1` while the piece is in the piece bar, i.e. not placed yet.
     */
    x: number
    /**
     * Row of the top-left corner of the piece on the board.
     * `-1` while the piece is in the piece bar, i.e. not placed yet.
     */
    y: number
    /** Clockwise rotation, in quarter turns: `0`, `1`, `2` or `3`. */
    rotation: number
    /** Set while the piece overlaps another piece or a fixed constraint. */
    unstable: boolean
    _shape: number[][]

    constructor(typeId: number, shape: number[][]) {
        this.typeId = typeId
        this._shape = shape
        // the shape matrix is indexed as `shape[y][x]`
        this.width = shape[0]!.length
        this.height = shape.length

        this.x = -1
        this.y = -1
        this.rotation = 0
        this.unstable = false
    }

    setRotation(rotation: number) {
        // `%` keeps the sign of the dividend, so negative input has to be folded back by hand
        this.rotation = ((Math.floor(rotation) % 4) + 4) % 4
    }

    /** Rotate the piece by 90 degrees clockwise. */
    rotateCW() {
        this.setRotation(this.rotation + 1)
    }

    /** `true` while the piece sits on the board. */
    get isPlaced(): boolean {
        return this.x >= 0 && this.y >= 0
    }

    /** The blocks of the shape, in the shape's own coordinates. */
    getShapeCells(): {x: number, y: number}[] {
        const cells: {x: number, y: number}[] = []
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this._shape[y]?.[x]) {
                    cells.push({x, y})
                }
            }
        }
        return cells
    }

    /** Size of the piece after `rotation` quarter turns, in blocks. */
    getRotatedSize(rotation: number = this.rotation): {width: number, height: number} {
        const quarterTurns = ((Math.floor(rotation) % 4) + 4) % 4
        return quarterTurns % 2 === 0
            ? {width: this.width, height: this.height}
            : {width: this.height, height: this.width}
    }

    /**
     * The board blocks the piece covers when the top-left corner of its
     * rotated bounding box is placed at (`row`, `col`).
     */
    getBoardCells(row: number, col: number, rotation: number = this.rotation): BoardCell[] {
        const quarterTurns = ((Math.floor(rotation) % 4) + 4) % 4
        const width = this.width
        const height = this.height

        return this.getShapeCells().map(cell => {
            // rotating clockwise by 90 degrees maps the shape's (x, y) like this:
            let rowOffset: number
            let colOffset: number
            if (quarterTurns === 0) {
                rowOffset = cell.y
                colOffset = cell.x
            } else if (quarterTurns === 1) {
                rowOffset = cell.x
                colOffset = height - 1 - cell.y
            } else if (quarterTurns === 2) {
                rowOffset = height - 1 - cell.y
                colOffset = width - 1 - cell.x
            } else {
                rowOffset = width - 1 - cell.x
                colOffset = cell.y
            }
            return {row: row + rowOffset, col: col + colOffset}
        })
    }
}
