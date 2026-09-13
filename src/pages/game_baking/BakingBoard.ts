export default class BakingBoard {
    /**
     * Baking board state data
     */

    numRows: number
    numCols: number
    numTypes: number
    _matrix: number[][]

    constructor(numRows: number, numCols: number, numTypes: number, matrix?: number[][]) {
        this.numRows = numRows
        this.numCols = numCols
        this.numTypes = numTypes
        this._matrix = []

        if (matrix) {
            // ensure matrix has correct shape and value range
            assertMatrix(matrix, numRows, numCols, numTypes)
            this._matrix = matrix
        } else {
            // create zero matrix
            for (let i = 0; i < numRows; i++) {
                const row = []
                for (let j = 0; j < numCols; j++) {
                    row.push(0)
                }
                this._matrix.push(row)
            }

        }
    }


    getMatrix() {
        return this._matrix
    }


    tapAt(rowInd: number, colInd: number) {
        const coords = [
            [rowInd, colInd],
            [rowInd + 1, colInd],
            [rowInd - 1, colInd],
            [rowInd, colInd + 1],
            [rowInd, colInd - 1],
        ]
        for (let coord of coords) {
            const rowInd = coord[0] as number
            const colInd = coord[1] as number
            if (rowInd >= 0 && rowInd < this.numRows && colInd >= 0 && colInd < this.numCols) {
                this._matrix[rowInd]![colInd] = (this._matrix[rowInd]![colInd]! + 1) % this.numTypes
            }
        }
    }
}


function assertMatrix(matrix: number[][], numRows: number, numCols: number, numTypes: number) {
    const r = matrix.length
    if (r !== numRows) {
        throw new Error("matrix numRow assertion failed")
    }
    for (let row of matrix) {
        if (row.length !== numCols) {
            throw new Error("matrix numCol assertion failed")
        }
    }
    const max = Math.max(...matrix.flat());
    if (max >= numTypes) {
        throw new Error("matrix numTypes assertion failed")
    }
    const min = Math.min(...matrix.flat());
    if (min < 0) {
        throw new Error("matrix minValue assertion failed")
    }
}