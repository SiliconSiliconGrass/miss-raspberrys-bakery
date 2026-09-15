import Piece from "./Piece";
import FixedConstraint from "./FixedConstraint";

export default class GameState {

    numRows: number
    numCols: number
    numTypes: number
    /** rowDemands[rowInd][typeInd]: how many blocks of type (typeInd + 1) this row contains. */
    rowDemands: number[][]
    /** colDemands[colInd][typeInd]: how many blocks of type (typeInd + 1) this column contains. */
    colDemands: number[][]
    pieces: Piece[]
    fixed: FixedConstraint[]

    constructor(
        numRows: number,
        numCols: number,
        numTypes: number,
        rowDemands: number[][],
        colDemands: number[][],
        pieces: Piece[],
        fixed: FixedConstraint[]
    ) {
        this.numRows = numRows
        this.numCols = numCols
        this.numTypes = numTypes
        this.rowDemands = rowDemands
        this.colDemands = colDemands
        this.pieces = pieces
        this.fixed = fixed
    }
}
