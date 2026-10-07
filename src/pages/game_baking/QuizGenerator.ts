import Random from "@/utils/random/Random";
import BakingBoard from "./BakingBoard";

export default class QuizGenerator {

    _answer: BakingBoard
    /** The seeded source every random draw of this quiz comes from. */
    private random: Random

    constructor(
        seed: string,
        answer?: BakingBoard,
        numRows?: number,
        numCols?: number,
        numTypes?: number,
    ) {
        this.random = new Random(seed)

        numTypes = 2 // currently only 2 types
        
        if (!answer) {
            if (!numRows) {
                numRows = this.random.randint(3, 7)
            }
            if (!numCols) {
                numCols = this.random.randint(3, 7)
            }
            if (!numTypes) {
                numTypes = this.random.randint(2, 3)
            }

            // zero matrix
            this._answer = new BakingBoard(numRows, numCols, numTypes)

            // diagonal symmetries are only valid on a square board
            const symetricType = this.random.randint(0, numRows === numCols ? 4 : 2)
            const numVar = this.random.randint(10, 20)
            for (let i = 0; i < numVar; i++) {
                const rowInd = this.random.randint(0, numRows - 1)
                const colInd = this.random.randint(0, numCols - 1)
                const typeId = this.random.randint(1, numTypes - 1)

                let targets
                if (symetricType === 0) {
                    // center symetric
                    targets = [
                        [rowInd, colInd],
                        [numRows - rowInd - 1, numCols - colInd - 1]
                    ]
                } else if (symetricType === 1) {
                    // left-right symetric
                    targets = [
                        [rowInd, colInd],
                        [rowInd, numCols - colInd - 1]
                    ]
                } else if (symetricType === 2) {
                    // top-bottom symetric
                    targets = [
                        [rowInd, colInd],
                        [numRows - rowInd - 1, colInd]
                    ]
                } else if (symetricType === 3) {
                    // "\" symetric
                    targets = [
                        [rowInd, colInd],
                        [colInd, rowInd]
                    ]
                } else {
                    // symetricType === 4
                    // "\" symetric
                    targets = [
                        [rowInd, colInd],
                        [numCols - colInd - 1, numRows - rowInd - 1]
                    ]
                }

                for (let target of targets) {
                    const rowInd = target[0] as number
                    const colInd = target[1] as number
                    if (rowInd < 0 || rowInd >= numRows || colInd < 0 || colInd >= numCols) {
                        continue
                    }
                    
                    this._answer._matrix[rowInd]![colInd] = typeId
                }
            }

        } else {
            this._answer = answer
        }
    }


    getAnswer() {
        return this._answer
    }


    generate() {
        // copy a baking board
        const quiz = new BakingBoard(
            this._answer.numRows,
            this._answer.numCols,
            this._answer.numTypes,
            this._answer._matrix.map(row => [...row])
        )
        const numTaps = this.random.randint(3, 10)
        for (let i = 0; i < numTaps; i++) {
            const rowInd = this.random.randint(0, this._answer.numRows - 1)
            const colInd = this.random.randint(0, this._answer.numCols - 1)
            quiz.tapAt(rowInd, colInd)
        }
        return quiz
    }
}
