export default class FixedConstraint {
    /**
     * Fixed constraint on game board.
     * When typeId === -1, it means this is a void constraint,
     * which no piece should overlap.
     */
    x: number
    y: number
    typeId: number

    constructor(x: number, y: number, typeId: number) {
        this.x = x
        this.y = y
        this.typeId = typeId
    }
}
