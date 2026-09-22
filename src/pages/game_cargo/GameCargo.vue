<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

import { GameAutomationBridge, GameAutomationPanel } from '../../automation';

import type GameState from './GameState';
import type Piece from './Piece';
import type { BoardCell } from './Piece';
import QuizGenerator from './QuizGenerator';


/** Gap between two neighboring blocks of the board, in px. */
const CELL_GAP = 6
/** The blocks of the board are kept between these sizes, in px. */
const MIN_BLOCK_SIZE = 20
const MAX_BLOCK_SIZE = 84
/** Free space kept around the whole layout, as a ratio of the shortest screen edge. */
const SCREEN_MARGIN_RATIO = 0.035
/** The piece bar takes this ratio of the screen width, clamped to the given range. */
const PIECE_BAR_WIDTH_RATIO = 0.17
const MIN_PIECE_BAR_WIDTH = 150
const MAX_PIECE_BAR_WIDTH = 300
/** Size of the constraint labels, as ratios of the block size. */
const LABEL_ICON_RATIO = 0.62
const LABEL_ICON_GAP_RATIO = 0.1
const LABEL_PADDING_RATIO = 0.16
const LABEL_EDGE_RATIO = 0.24
/** A press which moves less than this distance (px) is a click, not a drag. */
const DRAG_THRESHOLD = 4
/** Durations of the animations, in ms. */
const PICK_DURATION = 240
const SNAP_DURATION = 130
const FLY_BACK_DURATION = 280
/**
 * How long a piece takes to fly to a place it was told to go, and how long it
 * takes to turn, in ms. Both are the same on purpose: a piece which is moved and
 * turned in one go (which is what a player program does) reaches its place
 * already facing the right way, instead of turning on the way and then drifting.
 */
const PIECE_MOVE_DURATION = 380
/** How far a bridge reaches into the blocks it glues together, in px: hides the seams. */
const BRIDGE_OVERLAP = 1
/** Room kept free for the scrollbar of the piece bar, in px. */
const PIECE_BAR_SCROLLBAR_WIDTH = 12
/**
 * How wide the score and the submit area get: the font of their rows is a ratio of
 * the viewport (keep it in sync with `.demand-preview` in the style below), and the
 * widest row of them is about this many characters wide. Their column stays free of
 * the board, so that neither of them can end up on top of it.
 */
const PANEL_FONT_WIDTH_RATIO = 0.018
const PANEL_FONT_HEIGHT_RATIO = 0.028
const PANEL_WIDTH_EM = 11
/** Extra room between the board and that column, in px. */
const SIDE_PANEL_CLEARANCE = 12
/**
 * Room the automation panel takes at the right edge: its width, plus the inset it
 * keeps from the screen edge. Keep both in sync with `GameAutomationPanel`
 * (`width: min(20vw, 220px)`, `right: min(5vw, 5vh)`).
 */
const AUTOMATION_PANEL_WIDTH = 220
const AUTOMATION_PANEL_WIDTH_RATIO = 0.2
const AUTOMATION_PANEL_INSET_RATIO = 0.05
/** How long one half of the submit transition takes, in ms: submitting waits twice that. */
const FADE_DURATION = 1000
/** The shortest time between two submissions, in ms. */
const SUBMIT_INTERVAL = 2000

/**
 * The item drawn for every block type, in the order the types are numbered:
 * type 1 uses the first image, type 2 the second one, and so on.
 */
const ITEM_IMAGE_LIST = [
    // '/images/it/flour.png',
    // '/images/it/water_bucket.png',
    '/images/it/energy_bread.svg',
]


/** One entry per piece of the game state, holding the piece itself and all of its elements. */
interface PieceView {
    /** Index of the piece inside `game.pieces`. */
    ind: number
    piece: Piece
    /** `.piece`: the positioned element of the piece. */
    el: HTMLDivElement
    /** `.piece-body`: rotates with the piece and scales it down inside the piece bar. */
    body: HTMLDivElement
    /** The blocks of the piece, with their coordinates inside the shape. */
    cells: {
        el: HTMLDivElement
        icon: HTMLDivElement
        x: number
        y: number
        /** The sides this block shares with another block of the same piece. */
        merged: {up: boolean, down: boolean, left: boolean, right: boolean}
    }[]
    /** Brown patches which fill the room between the blocks of the piece. */
    bridges: PieceBridge[]
    /** `.piece-slot`: the square the piece owns in the piece bar, empty while the piece is on the board. */
    slot: HTMLDivElement
    /** Where the element of the piece currently lives. */
    host: 'bar' | 'board' | 'drag'
    /** Center of the piece in viewport coordinates, only used while it is being dragged. */
    centerX: number
    centerY: number
}


/** A brown patch which fills the gap between two neighboring blocks of one piece. */
interface PieceBridge {
    el: HTMLDivElement
    /** `true` while the patch fills the gap right of (`x`, `y`), `false` while it is below it. */
    horizontal: boolean
    x: number
    y: number
    /** `true` for the middle of a block of four, which is the one patch the other three leave open. */
    junction: boolean
}


/** A press which grew into a drag. */
interface DragState {
    ind: number
    /** Offset of the center of the piece from the mouse, in px. */
    offsetX: number
    offsetY: number
    /** Placement the piece would snap to when the mouse is released, `null` when there is none. */
    target: BoardCell | null
}


/** A mouse down which is not a drag yet. */
interface PressState {
    ind: number
    startX: number
    startY: number
}


let game: GameState | null = null
let pieceViews: PieceView[] = []
/** `boardCells[row][col]`, used to highlight the blocks a drop would snap to. */
let boardCells: HTMLDivElement[][] = []
let selectedInd: number | null = null
let drag: DragState | null = null
let press: PressState | null = null
/** Blocks of the board highlighted by the drag which is currently going on. */
let previewCells: HTMLDivElement[] = []

/** Layout values in px, recomputed by `fitLayout()` and used by every other function. */
let blockSize = 0
let cellPitch = 0
let barBlockSize = 0
let barPitch = 0
/** Width of the widest slot of the piece bar, which is also the width of its only column. */
let slotSize = 0
/** Room between two slots of the piece bar, and between its edge and a slot, in px. */
let slotGap = 0
let barPadding = 0

/** How well the board answers what the rows and the columns ask for, between 0 and 1. */
const satisfaction = ref(0)
/** What the current board would score: `10` for a perfect answer, otherwise a tenth of it. */
const expectedScore = ref(0)
const totalScore = ref(0)
const isSubmitting = ref(false)
const fadePhase = ref<'idle' | 'out' | 'in'>('idle')
/** Timers of the submit transition, so that leaving the page stops them. */
let fadeTimerIds: number[] = []
/** When the last submission happened, in ms. */
let lastSubmitTime = 0

const satisfactionText = computed(() => `${(satisfaction.value * 100).toFixed(2)}%`)
const expectedScoreText = computed(() => expectedScore.value.toFixed(2))
const totalScoreText = computed(() => totalScore.value.toFixed(2))
const isDemandMet = computed(() => satisfaction.value >= 1)
const fadeClass = computed(() => fadePhase.value === 'idle' ? '' : `is-fading-${fadePhase.value}`)

const boardArea = ref<HTMLDivElement | null>(null)
const gridArea = ref<HTMLDivElement | null>(null)
const pieceLayer = ref<HTMLDivElement | null>(null)
const rowLabelStrip = ref<HTMLDivElement | null>(null)
const colLabelStrip = ref<HTMLDivElement | null>(null)
const pieceBar = ref<HTMLDivElement | null>(null)
const pieceBarHint = ref<HTMLDivElement | null>(null)
const pieceBarList = ref<HTMLDivElement | null>(null)
const dragLayer = ref<HTMLDivElement | null>(null)


function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}


/** The image of the item with the given type id. */
function getItemImage(typeId: number) {
    const imageCount = ITEM_IMAGE_LIST.length
    return ITEM_IMAGE_LIST[((typeId - 1) % imageCount + imageCount) % imageCount] as string
}


/**
 * Size of a piece which is drawn with the given distance between two neighboring
 * blocks (`pitch`) and the given block size (`block`), in px.
 */
function getPieceBox(piece: Piece, pitch: number, block: number) {
    const gap = pitch - block
    return {
        width: piece.width * pitch - gap,
        height: piece.height * pitch - gap,
    }
}


/** Room between two blocks of the piece bar: it shrinks with the blocks of the bar. */
function getBarGap(block: number) {
    return Math.max(2, Math.round(CELL_GAP * block / blockSize / 2) * 2)
}


/** Thickness of a constraint label strip, in multiples of the block size. */
function getLabelThicknessRatio(numTypes: number) {
    return 2 * LABEL_PADDING_RATIO
        + numTypes * LABEL_ICON_RATIO
        + (numTypes - 1) * LABEL_ICON_GAP_RATIO
}


// ---------------------------------------------------------------------------
// building the quiz
// ---------------------------------------------------------------------------

function initRandomQuiz() {
    const quizGenerator = new QuizGenerator()
    game = quizGenerator.generate()
    console.log(quizGenerator.getAnswer())
    console.log(game)

    // drop everything which is left of the previous quiz
    selectedInd = null
    drag = null
    press = null
    previewCells = []
    pieceViews = []
    boardCells = []
    pieceLayer.value?.replaceChildren()
    dragLayer.value?.replaceChildren()
    pieceBarList.value?.replaceChildren()

    pieceViews = game.pieces.map((piece, ind) => createPieceView(piece, ind))
    buildBoardCells()
    buildConstraintLabels()
    buildPieceBar()
    // every piece starts in the piece bar, scaled down inside its own slot
    for (const view of pieceViews) {
        attachToBar(view)
    }
}


function createPieceView(piece: Piece, ind: number): PieceView {
    const el = document.createElement('div')
    el.className = 'piece'

    const body = document.createElement('div')
    body.className = 'piece-body'
    el.appendChild(body)

    const shapeCells = piece.getShapeCells()
    const occupied = new Set(shapeCells.map(cell => cell.y * piece.width + cell.x))
    const isOccupied = (x: number, y: number) => x >= 0 && x < piece.width && y >= 0 && y < piece.height
        && occupied.has(y * piece.width + x)

    const cells = shapeCells.map(cell => {
        const merged = {
            up: isOccupied(cell.x, cell.y - 1),
            down: isOccupied(cell.x, cell.y + 1),
            left: isOccupied(cell.x - 1, cell.y),
            right: isOccupied(cell.x + 1, cell.y),
        }

        const cellEl = document.createElement('div')
        cellEl.className = 'piece-cell'
        // the sides which are glued to a neighbor lose their outline, so that the blocks of
        // one piece read as one chunk instead of a row of separate blocks
        if (merged.up) cellEl.style.borderTopColor = 'transparent'
        if (merged.down) cellEl.style.borderBottomColor = 'transparent'
        if (merged.left) cellEl.style.borderLeftColor = 'transparent'
        if (merged.right) cellEl.style.borderRightColor = 'transparent'

        const icon = document.createElement('div')
        icon.className = 'cell-icon'
        icon.style.backgroundImage = `url("${getItemImage(piece.typeId)}")`
        cellEl.appendChild(icon)
        body.appendChild(cellEl)

        // the mouse listens on the blocks themselves: the empty room inside the bounding box
        // of a piece must never swallow a click which belongs to a neighboring piece
        cellEl.addEventListener('mousedown', (event) => onPieceMouseDown(ind, event))

        return {el: cellEl, icon, x: cell.x, y: cell.y, merged}
    })

    // the brown patches are added on top of the blocks, so that they also cover the shadows
    // which the blocks draw into the room between them
    const bridges: PieceBridge[] = []
    for (const cell of shapeCells) {
        const x = cell.x
        const y = cell.y

        if (isOccupied(x + 1, y)) {
            bridges.push(createPieceBridge(body, true, x, y, {
                // the gap of a piece side is only closed when a block sits on both of its sides
                top: !(isOccupied(x, y - 1) && isOccupied(x + 1, y - 1)),
                bottom: !(isOccupied(x, y + 1) && isOccupied(x + 1, y + 1)),
            }))
        }
        if (isOccupied(x, y + 1)) {
            bridges.push(createPieceBridge(body, false, x, y, {
                left: !(isOccupied(x - 1, y) && isOccupied(x - 1, y + 1)),
                right: !(isOccupied(x + 1, y) && isOccupied(x + 1, y + 1)),
            }))
        }
        if (isOccupied(x + 1, y) && isOccupied(x, y + 1) && isOccupied(x + 1, y + 1)) {
            bridges.push(createPieceBridge(body, true, x, y, {}, true))
        }
    }
    for (const bridge of bridges) {
        bridge.el.addEventListener('mousedown', (event) => onPieceMouseDown(ind, event))
    }

    const slot = document.createElement('div')
    slot.className = 'piece-slot'

    return {ind, piece, el, body, cells, bridges, slot, host: 'bar', centerX: 0, centerY: 0}
}


/**
 * A brown patch which fills the room between two blocks of the same piece.
 * `outline` marks the sides of the patch which look out of the piece: those
 * keep the outline of the piece, the other sides stay open and merge with it.
 */
function createPieceBridge(
    body: HTMLDivElement,
    horizontal: boolean,
    x: number,
    y: number,
    outline: {top?: boolean, right?: boolean, bottom?: boolean, left?: boolean},
    junction = false,
): PieceBridge {
    const el = document.createElement('div')
    el.className = 'piece-bridge'
    // if (outline.top) el.style.borderTopColor = 'var(--piece-outline)'
    // if (outline.right) el.style.borderRightColor = 'var(--piece-outline)'
    // if (outline.bottom) el.style.borderBottomColor = 'var(--piece-outline)'
    // if (outline.left) el.style.borderLeftColor = 'var(--piece-outline)'
    body.appendChild(el)

    return {el, horizontal, x, y, junction}
}


/** The blocks of the board, with the fixed constraints of the game state drawn on them. */
function buildBoardCells() {
    if (!game || !gridArea.value || !pieceLayer.value) {
        return
    }

    boardCells = []
    const cells: HTMLDivElement[] = []

    for (let rowInd = 0; rowInd < game.numRows; rowInd++) {
        const row: HTMLDivElement[] = []
        for (let colInd = 0; colInd < game.numCols; colInd++) {
            const cell = document.createElement('div')
            cell.className = 'board-cell'
            cell.id = `cargo_cell_${rowInd}_${colInd}`

            const fixed = game.fixed.find(constraint => constraint.x === colInd && constraint.y === rowInd)
            if (fixed) {
                if (fixed.typeId === -1) {
                    cell.classList.add('is-void')
                    cell.title = '空位：任何货物都不能放在这里'
                } else {
                    cell.classList.add('is-fixed')
                    cell.title = '已经装箱的货物：不能再被其他货物覆盖'
                    const icon = document.createElement('div')
                    icon.className = 'cell-icon'
                    icon.style.backgroundImage = `url("${getItemImage(fixed.typeId)}")`
                    cell.appendChild(icon)
                }
            }

            row.push(cell)
            cells.push(cell)
        }
        boardCells.push(row)
    }

    // the piece layer stays the last child, so that the pieces are drawn on top of the blocks
    gridArea.value.replaceChildren(...cells, pieceLayer.value)
}


/** The item icons with their demand, on the left of every row and above every column. */
function buildConstraintLabels() {
    if (!game || !rowLabelStrip.value || !colLabelStrip.value) {
        return
    }

    const numTypes = game.numTypes
    const rowLabels = game.rowDemands.map(demands => {
        const label = document.createElement('div')
        label.className = 'constraint constraint-row'
        for (let typeInd = 0; typeInd < numTypes; typeInd++) {
            label.appendChild(createConstraintItem(typeInd, demands[typeInd] ?? 0))
        }
        return label
    })

    const colLabels = game.colDemands.map(demands => {
        const label = document.createElement('div')
        label.className = 'constraint constraint-col'
        for (let typeInd = 0; typeInd < numTypes; typeInd++) {
            label.appendChild(createConstraintItem(typeInd, demands[typeInd] ?? 0))
        }
        return label
    })

    rowLabelStrip.value.replaceChildren(...rowLabels)
    colLabelStrip.value.replaceChildren(...colLabels)
}


function createConstraintItem(typeInd: number, demand: number) {
    const item = document.createElement('div')
    item.className = 'constraint-item'
    item.style.backgroundImage = `url("${getItemImage(typeInd + 1)}")`

    const demandText = document.createElement('span')
    demandText.className = 'constraint-demand'
    demandText.textContent = `x${demand}`
    item.appendChild(demandText)

    return item
}


/** One slot per piece: the slots never move, so the piece bar does not jump around. */
function buildPieceBar() {
    if (!pieceBarList.value) {
        return
    }
    pieceBarList.value.replaceChildren(...pieceViews.map(view => view.slot))
}


// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/**
 * Size the board and the piece bar so that both of them fit on the screen,
 * with a margin on every side and without overlapping each other.
 */
function fitLayout() {
    if (!game || !boardArea.value || !gridArea.value || !pieceBar.value
        || !pieceBarList.value || !rowLabelStrip.value || !colLabelStrip.value) {
        return
    }

    const viewWidth = window.innerWidth
    const viewHeight = window.innerHeight
    const margin = Math.round(clamp(Math.min(viewWidth, viewHeight) * SCREEN_MARGIN_RATIO, 12, 48))
    const barWidth = Math.round(clamp(viewWidth * PIECE_BAR_WIDTH_RATIO, MIN_PIECE_BAR_WIDTH, MAX_PIECE_BAR_WIDTH))
    const barBoardGap = Math.max(margin, 16)
    // the score sits in the top right corner, the submit area in the bottom right one and
    // the automation panel between them: their column stays free, so that the board can
    // never end up underneath one of them
    const panelFontSize = Math.min(viewWidth * PANEL_FONT_WIDTH_RATIO, viewHeight * PANEL_FONT_HEIGHT_RATIO)
    const automationPanelWidth = Math.min(viewWidth * AUTOMATION_PANEL_WIDTH_RATIO, AUTOMATION_PANEL_WIDTH)
        + Math.min(viewWidth * AUTOMATION_PANEL_INSET_RATIO, viewHeight * AUTOMATION_PANEL_INSET_RATIO)
    const sidePanelWidth = Math.round(
        Math.max(panelFontSize * PANEL_WIDTH_EM, automationPanelWidth) + SIDE_PANEL_CLEARANCE,
    )
    const rightEdge = viewWidth - Math.max(margin, sidePanelWidth)

    // the board is a square, so the block size is limited by the width and by the height.
    // an even block size keeps the blocks, the rooms between them and the half offsets of a
    // rotated piece on whole pixels, which is what keeps every edge of the board sharp
    const labelRatio = getLabelThicknessRatio(game.numTypes) + LABEL_EDGE_RATIO
    const availableWidth = rightEdge - margin - barWidth - barBoardGap
    const availableHeight = viewHeight - margin * 2
    blockSize = clamp(Math.floor(Math.min(
        (availableWidth - (game.numCols - 1) * CELL_GAP) / (game.numCols + labelRatio),
        (availableHeight - (game.numRows - 1) * CELL_GAP) / (game.numRows + labelRatio),
    ) / 2) * 2, MIN_BLOCK_SIZE, MAX_BLOCK_SIZE)
    cellPitch = blockSize + CELL_GAP

    const labelIconSize = Math.round(blockSize * LABEL_ICON_RATIO)
    const labelIconGap = Math.round(blockSize * LABEL_ICON_GAP_RATIO)
    const labelPadding = Math.round(blockSize * LABEL_PADDING_RATIO)
    const labelEdge = Math.round(blockSize * LABEL_EDGE_RATIO)
    const labelThickness = labelPadding * 2
        + game.numTypes * labelIconSize
        + (game.numTypes - 1) * labelIconGap
    const boardWidth = game.numCols * blockSize + (game.numCols - 1) * CELL_GAP
    const boardHeight = game.numRows * blockSize + (game.numRows - 1) * CELL_GAP
    const areaInset = labelThickness + labelEdge

    // the piece bar: as tall as the screen allows, against the left edge of the screen
    pieceBar.value.style.left = `${margin}px`
    pieceBar.value.style.top = `${margin}px`
    pieceBar.value.style.width = `${barWidth}px`
    pieceBar.value.style.height = `${viewHeight - margin * 2}px`

    // the board area: centered in the space which is left of the piece bar
    const areaLeft = margin + barWidth + barBoardGap
    const areaWidth = rightEdge - areaLeft
    // the blocks are centered in the window, not the whole board area: the labels on the
    // left of the board take room of their own, and centering the area would push the
    // blocks to the right by half of it
    const centeredGridLeft = Math.round((viewWidth - boardWidth) / 2)
    const gridLeft = Math.max(
        areaLeft + areaInset,
        Math.min(centeredGridLeft, rightEdge - boardWidth),
    )
    boardArea.value.style.left = `${gridLeft - areaInset}px`
    boardArea.value.style.top = `${Math.round((viewHeight - areaInset - boardHeight) / 2)}px`
    boardArea.value.style.width = `${areaInset + boardWidth}px`
    boardArea.value.style.height = `${areaInset + boardHeight}px`
    boardArea.value.style.setProperty('--block-size', `${blockSize}px`)
    boardArea.value.style.setProperty('--label-icon-size', `${labelIconSize}px`)
    boardArea.value.style.setProperty('--label-icon-gap', `${labelIconGap}px`)
    boardArea.value.style.setProperty('--label-padding', `${labelPadding}px`)

    // the constraint labels mirror the rows and the columns of the board
    rowLabelStrip.value.style.left = '0px'
    rowLabelStrip.value.style.top = `${areaInset}px`
    rowLabelStrip.value.style.width = `${labelThickness}px`
    rowLabelStrip.value.style.height = `${boardHeight}px`
    rowLabelStrip.value.style.gridTemplateRows = `repeat(${game.numRows}, ${blockSize}px)`
    rowLabelStrip.value.style.rowGap = `${CELL_GAP}px`

    colLabelStrip.value.style.left = `${areaInset}px`
    colLabelStrip.value.style.top = '0px'
    colLabelStrip.value.style.width = `${boardWidth}px`
    colLabelStrip.value.style.height = `${labelThickness}px`
    colLabelStrip.value.style.gridTemplateColumns = `repeat(${game.numCols}, ${blockSize}px)`
    colLabelStrip.value.style.columnGap = `${CELL_GAP}px`

    gridArea.value.style.left = `${areaInset}px`
    gridArea.value.style.top = `${areaInset}px`
    gridArea.value.style.width = `${boardWidth}px`
    gridArea.value.style.height = `${boardHeight}px`
    gridArea.value.style.gridTemplateColumns = `repeat(${game.numCols}, ${blockSize}px)`
    gridArea.value.style.gridAutoRows = `${blockSize}px`
    gridArea.value.style.gap = `${CELL_GAP}px`

    // the piece bar draws its pieces with their own, smaller block size: scaling a piece
    // down instead would put every edge of it between two pixels, and blur it
    barPadding = Math.max(8, Math.round(barWidth * 0.08))
    slotGap = Math.max(6, Math.round(barWidth * 0.06))
    // the scrollbar of the list takes room of its own, which is kept free on both cases
    const barRoom = barWidth - barPadding * 2 - PIECE_BAR_SCROLLBAR_WIDTH
    slotSize = Math.floor(barRoom / 2) * 2
    fitPieceBarBlocks()
    layoutPieceBar()
}


/**
 * Look for the biggest block size which still fits every piece of the piece bar
 * into its slot. Both the block size and the room between two blocks are whole
 * and even numbers, so that the pieces of the bar are drawn just as sharply as
 * the pieces of the board.
 */
function fitPieceBarBlocks() {
    const widestPiece = pieceViews.reduce(
        (widest, view) => Math.max(widest, view.piece.width, view.piece.height),
        2,
    )

    let block = Math.max(2, Math.floor(slotSize / widestPiece / 2) * 2)
    for (; block > 2; block -= 2) {
        const gap = getBarGap(block)
        if (widestPiece * (block + gap) - gap <= slotSize) {
            break
        }
    }

    barBlockSize = block
    barPitch = block + getBarGap(block)
}


/**
 * The room the slot of a piece takes in the piece bar, in px.
 *
 * Its width holds either turn of the piece, so that turning it does not move it
 * sideways, while its height follows the turn it is in: a tray of square slots
 * would waste a lot of room, and it has to be scrolled through.
 */
function getSlotBox(view: PieceView) {
    const piece = view.piece
    const gap = barPitch - barBlockSize
    return {
        width: Math.max(piece.width, piece.height) * barPitch - gap,
        height: piece.getRotatedSize().height * barPitch - gap,
    }
}


/**
 * Stack the slots of the piece bar and put every piece into its own slot. The
 * slots are centered by hand, with whole pixels: centering them with css can put
 * them between two pixels, which would draw the pieces of the bar blurry.
 */
function layoutPieceBar() {
    if (!pieceBarList.value) {
        return
    }
    const slotBoxes = pieceViews.map(view => getSlotBox(view))
    const columnWidth = slotBoxes.reduce((widest, box) => Math.max(widest, box.width), 0)
    const rowsHeight = slotBoxes.reduce((height, box) => height + box.height, 0)
        + Math.max(0, slotBoxes.length - 1) * slotGap
    const rowPadding = barPadding + Math.max(
        0,
        Math.floor((pieceBarList.value.clientHeight - rowsHeight - barPadding * 2) / 2),
    )
    const columnPadding = barPadding + Math.max(
        0,
        Math.floor((pieceBarList.value.clientWidth - barPadding * 2 - columnWidth) / 2),
    )

    pieceBarList.value.style.gridTemplateColumns = `${columnWidth}px`
    pieceBarList.value.style.gap = `${slotGap}px`
    pieceBarList.value.style.padding = `${rowPadding}px ${columnPadding}px ${barPadding}px`

    for (const view of pieceViews) {
        const slotBox = getSlotBox(view)
        view.slot.style.width = `${slotBox.width}px`
        view.slot.style.height = `${slotBox.height}px`
        applyPieceStyle(view)
    }
}


/** Move the element of a piece to where its current host expects it to be. */
function applyPieceStyle(view: PieceView) {
    const piece = view.piece
    const inBar = view.host === 'bar'
    // the piece bar draws a piece with its own, smaller blocks instead of scaling it down
    const block = inBar ? barBlockSize : blockSize
    const pitch = inBar ? barPitch : cellPitch
    const box = getPieceBox(piece, pitch, block)
    const gap = pitch - block

    view.el.style.width = `${box.width}px`
    view.el.style.height = `${box.height}px`
    // the corners of a block stay round only where the piece ends, the glued ones are square
    const cellRadius = `${Math.max(3, Math.round(block * 0.11))}px`
    const noRadius = '0px'
    for (const cell of view.cells) {
        cell.el.style.left = `${cell.x * pitch}px`
        cell.el.style.top = `${cell.y * pitch}px`
        cell.el.style.width = `${block}px`
        cell.el.style.height = `${block}px`
        cell.el.style.borderRadius = [
            cell.merged.up || cell.merged.left ? noRadius : cellRadius,
            cell.merged.up || cell.merged.right ? noRadius : cellRadius,
            cell.merged.down || cell.merged.right ? noRadius : cellRadius,
            cell.merged.down || cell.merged.left ? noRadius : cellRadius,
        ].join(' ')
    }
    for (const bridge of view.bridges) {
        if (bridge.junction) {
            bridge.el.style.left = `${bridge.x * pitch + block - BRIDGE_OVERLAP}px`
            bridge.el.style.top = `${bridge.y * pitch + block - BRIDGE_OVERLAP}px`
            bridge.el.style.width = `${gap + BRIDGE_OVERLAP * 2}px`
            bridge.el.style.height = `${gap + BRIDGE_OVERLAP * 2}px`
        } else if (bridge.horizontal) {
            bridge.el.style.left = `${bridge.x * pitch + block - BRIDGE_OVERLAP}px`
            bridge.el.style.top = `${bridge.y * pitch}px`
            bridge.el.style.width = `${gap + BRIDGE_OVERLAP * 2}px`
            bridge.el.style.height = `${block}px`
        } else {
            bridge.el.style.left = `${bridge.x * pitch}px`
            bridge.el.style.top = `${bridge.y * pitch + block - BRIDGE_OVERLAP}px`
            bridge.el.style.width = `${block}px`
            bridge.el.style.height = `${gap + BRIDGE_OVERLAP * 2}px`
        }
    }

    view.body.style.transform = `rotate(${piece.rotation * 90}deg)`
    // the item of a block keeps its own direction: it is turned the other way around
    for (const cell of view.cells) {
        cell.icon.style.transform = `rotate(${piece.rotation * -90}deg)`
    }

    if (inBar) {
        const slotBox = getSlotBox(view)
        view.el.style.left = `${(slotBox.width - box.width) / 2}px`
        view.el.style.top = `${(slotBox.height - box.height) / 2}px`
    } else if (view.host === 'board') {
        // the piece turns around the center of its bounding box, which therefore may stick
        // out of the box itself: the element is shifted by half of that difference
        const size = piece.getRotatedSize()
        view.el.style.left = `${(piece.x - (piece.width - size.width) / 2) * pitch}px`
        view.el.style.top = `${(piece.y - (piece.height - size.height) / 2) * pitch}px`
    } else {
        view.el.style.left = `${view.centerX - box.width / 2}px`
        view.el.style.top = `${view.centerY - box.height / 2}px`
    }
}


function attachToBar(view: PieceView) {
    view.host = 'bar'
    view.slot.appendChild(view.el)
    view.slot.classList.add('is-occupied')
}


function attachToBoard(view: PieceView) {
    if (!pieceLayer.value) {
        return
    }
    view.host = 'board'
    pieceLayer.value.appendChild(view.el)
    view.slot.classList.remove('is-occupied')
}


function attachToDragLayer(view: PieceView) {
    if (!dragLayer.value) {
        return
    }
    view.host = 'drag'
    dragLayer.value.appendChild(view.el)
    view.slot.classList.remove('is-occupied')
}


// ---------------------------------------------------------------------------
// animations
// ---------------------------------------------------------------------------

/**
 * Animate an element from a place it was at before: the element has to be
 * where it belongs now already, `firstRect` is where it comes from.
 */
function animateFromRect(el: HTMLElement, firstRect: DOMRect, duration: number) {
    const lastRect = el.getBoundingClientRect()
    if (firstRect.width === 0 || lastRect.width === 0) {
        return
    }

    const scale = firstRect.width / lastRect.width
    const offsetX = (firstRect.left + firstRect.width / 2) - (lastRect.left + lastRect.width / 2)
    const offsetY = (firstRect.top + firstRect.height / 2) - (lastRect.top + lastRect.height / 2)
    if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5 && Math.abs(scale - 1) < 0.001) {
        return
    }

    cancelAnimations(el)
    el.animate(
        [
            {transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`},
            {transform: 'none'},
        ],
        {duration, easing: 'ease-out'},
    )
}


/**
 * How many quarter turns clockwise it takes to get from one turn to another,
 * so that a piece always turns forwards instead of taking the short way back.
 */
function getClockwiseTurns(fromRotation: number, toRotation: number) {
    return ((toRotation - fromRotation) % 4 + 4) % 4
}


/** Turn a piece by 90 degrees clockwise, starting from where it was drawn before. */
function animateRotation(view: PieceView, fromTurns: number, toTurns: number) {
    cancelAnimations(view.body)
    view.body.animate(
        [
            {transform: `rotate(${fromTurns * 90}deg)`},
            {transform: `rotate(${toTurns * 90}deg)`},
        ],
        {duration: PIECE_MOVE_DURATION, easing: 'ease-out'},
    )
    // the items counter-rotate in step with the piece, so that they stay upright all along
    for (const cell of view.cells) {
        cancelAnimations(cell.icon)
        cell.icon.animate(
            [
                {transform: `rotate(${fromTurns * -90}deg)`},
                {transform: `rotate(${toTurns * -90}deg)`},
            ],
            {duration: PIECE_MOVE_DURATION, easing: 'ease-out'},
        )
    }
}


/** Refuse a rotation the player asked for, so that the key press does not feel ignored. */
function animateRefusal(view: PieceView) {
    cancelAnimations(view.el)
    view.el.animate(
        [
            {transform: 'rotate(0deg)'},
            {transform: 'rotate(-3deg)'},
            {transform: 'rotate(3deg)'},
            {transform: 'rotate(0deg)'},
        ],
        {duration: 200, easing: 'ease-in-out'},
    )
}


function cancelAnimations(el: HTMLElement) {
    for (const animation of el.getAnimations()) {
        animation.cancel()
    }
}


// ---------------------------------------------------------------------------
// selection and stability
// ---------------------------------------------------------------------------

function refreshPieceClasses(view: PieceView) {
    const isUnstable = view.piece.unstable && view.host === 'board'
    view.el.classList.toggle('is-selected', selectedInd === view.ind)
    view.el.classList.toggle('is-unstable', isUnstable)
    // the tooltip lives on the blocks, because the container does not take mouse events
    for (const cell of view.cells) {
        cell.el.title = isUnstable ? '不稳定：与别的货物或空位重叠了' : ''
    }
}


function select(ind: number | null) {
    if (selectedInd === ind) {
        return
    }
    selectedInd = ind
    for (const view of pieceViews) {
        refreshPieceClasses(view)
    }
}


/** Every block which is already taken, by a placed piece or by a fixed constraint. */
function getBusyCells(excludeInd: number | null) {
    const busy = new Set<number>()
    if (!game) {
        return busy
    }

    for (const view of pieceViews) {
        const piece = view.piece
        if (view.ind === excludeInd || !piece.isPlaced) {
            continue
        }
        for (const cell of piece.getBoardCells(piece.y, piece.x)) {
            busy.add(cell.row * game.numCols + cell.col)
        }
    }
    for (const constraint of game.fixed) {
        busy.add(constraint.y * game.numCols + constraint.x)
    }
    return busy
}


function hasConflict(cells: BoardCell[], excludeInd: number | null) {
    if (!game) {
        return false
    }
    const busy = getBusyCells(excludeInd)
    return cells.some(cell => busy.has(cell.row * game!.numCols + cell.col))
}


/** A placed piece which overlaps something else is unstable, and glows red. */
function checkStability(view: PieceView) {
    const piece = view.piece
    piece.unstable = piece.isPlaced && hasConflict(piece.getBoardCells(piece.y, piece.x), view.ind)
    refreshPieceClasses(view)
}


// ---------------------------------------------------------------------------
// dragging
// ---------------------------------------------------------------------------

function onPieceMouseDown(ind: number, event: MouseEvent) {
    // the board is not the player's while it fades away and the next quiz is prepared
    if (event.button !== 0 || !game || isSubmitting.value) {
        return
    }
    event.preventDefault()

    // touching a piece settles the board: the other unstable pieces fly back to the piece bar
    sendUnstablePiecesHome(ind)
    select(ind)
    refreshPreview()

    press = {ind, startX: event.clientX, startY: event.clientY}
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)
}


/**
 * Pressing a piece picks that piece; pressing anywhere else - the room around the
 * board, the board itself, the tray - is pressing empty room, which drops the
 * selection. The listener sits on the window because the empty room is not one
 * element: it is everything which is not a block of a piece.
 */
function onEmptyRoomMouseDown(event: MouseEvent) {
    if (isSubmitting.value) {
        return
    }
    const target = event.target as HTMLElement | null
    if (!target?.closest('.piece-cell, .piece-bridge')) {
        select(null)
    }
}


function onWindowMouseMove(event: MouseEvent) {
    if (press) {
        const distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY)
        if (distance >= DRAG_THRESHOLD) {
            beginDrag(press.ind, event)
            press = null
        }
    }
    if (drag) {
        updateDrag(event.clientX, event.clientY)
    }
}


function onWindowMouseUp() {
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)
    press = null
    document.body.style.cursor = ''

    if (!drag) {
        return
    }
    const dragState = drag
    drag = null
    clearDropPreview()
    dropPiece(dragState)
}


function beginDrag(ind: number, event: MouseEvent) {
    const view = pieceViews[ind]!
    const piece = view.piece
    const firstRect = view.el.getBoundingClientRect()
    const size = piece.getRotatedSize()

    // `getBoundingClientRect()` of the element measures its own, unturned box, because the
    // turn sits on the body inside it. what the player grabbed is the turned box, so the
    // spot is read off the turned box: it shares the center with the element, and it is as
    // big as the element's box scaled by whatever the piece is being animated with
    const inBar = view.host === 'bar'
    const block = inBar ? barBlockSize : blockSize
    const pitch = inBar ? barPitch : cellPitch
    const gap = pitch - block
    const box = getPieceBox(piece, pitch, block)
    const scale = box.width > 0 ? firstRect.width / box.width : 1
    const visibleWidth = (size.width * pitch - gap) * scale
    const visibleHeight = (size.height * pitch - gap) * scale
    const centerX = firstRect.left + firstRect.width / 2
    const centerY = firstRect.top + firstRect.height / 2

    // the piece grows from its size in the piece bar to its size on the board, so the spot
    // the player grabbed is remembered as a fraction of the piece instead of a distance
    const fractionX = visibleWidth > 0 ? (event.clientX - centerX) / visibleWidth : 0
    const fractionY = visibleHeight > 0 ? (event.clientY - centerY) / visibleHeight : 0

    drag = {
        ind,
        offsetX: -fractionX * (size.width * cellPitch - CELL_GAP),
        offsetY: -fractionY * (size.height * cellPitch - CELL_GAP),
        target: null,
    }

    document.body.style.cursor = 'grabbing'
    attachToDragLayer(view)
    updateDrag(event.clientX, event.clientY)
    animateFromRect(view.el, firstRect, PICK_DURATION)
}


function updateDrag(clientX: number, clientY: number) {
    if (!drag) {
        return
    }
    const view = pieceViews[drag.ind]!
    view.centerX = clientX + drag.offsetX
    view.centerY = clientY + drag.offsetY
    applyPieceStyle(view)
    updateDropTarget(view)
}


/** Look for the blocks the piece would snap to, and highlight them. */
function updateDropTarget(view: PieceView) {
    if (!game || !gridArea.value || !drag) {
        return
    }

    const piece = view.piece
    const size = piece.getRotatedSize()
    const gridRect = gridArea.value.getBoundingClientRect()
    const centerX = view.centerX - gridRect.left
    const centerY = view.centerY - gridRect.top
    const col = Math.round((centerX - (size.width * cellPitch - CELL_GAP) / 2) / cellPitch)
    const row = Math.round((centerY - (size.height * cellPitch - CELL_GAP) / 2) / cellPitch)

    // there is no place to snap to unless the whole piece fits on the board
    if (row < 0 || col < 0 || row + size.height > game.numRows || col + size.width > game.numCols) {
        drag.target = null
        clearDropPreview()
        return
    }

    const cells = piece.getBoardCells(row, col)
    drag.target = {row, col}
    showDropPreview(cells, hasConflict(cells, view.ind))
}


function showDropPreview(cells: BoardCell[], isConflict: boolean) {
    clearDropPreview()
    for (const cell of cells) {
        const cellEl = boardCells[cell.row]?.[cell.col]
        if (!cellEl) {
            continue
        }
        cellEl.classList.add(isConflict ? 'is-drop-conflict' : 'is-drop-target')
        previewCells.push(cellEl)
    }
}


function clearDropPreview() {
    for (const cellEl of previewCells) {
        cellEl.classList.remove('is-drop-target', 'is-drop-conflict')
    }
    previewCells = []
}


function dropPiece(dragState: DragState) {
    const view = pieceViews[dragState.ind]!
    const piece = view.piece
    const firstRect = view.el.getBoundingClientRect()

    if (dragState.target) {
        piece.x = dragState.target.col
        piece.y = dragState.target.row
        attachToBoard(view)
        applyPieceStyle(view)
        animateFromRect(view.el, firstRect, SNAP_DURATION)
        checkStability(view)
        select(view.ind)
    } else {
        // there is nothing to snap to, so the piece flies back into the piece bar
        sendPiecesToBar([view])
    }
    refreshPreview()
}


/**
 * Send several pieces back into the piece bar at once. They are stacked in one
 * go: stacking the tray once per piece would move the earlier ones twice.
 */
function sendPiecesToBar(views: PieceView[]) {
    if (views.length === 0) {
        return
    }

    const flying = views.map(view => ({view, firstRect: view.el.getBoundingClientRect()}))
    for (const {view} of flying) {
        view.piece.unstable = false
        view.piece.x = -1
        view.piece.y = -1
        attachToBar(view)
    }
    layoutPieceBar()
    // at least the first of them has to be on screen for its flight to be seen
    flying[0]!.view.slot.scrollIntoView({block: 'nearest'})

    let droppedSelection = false
    for (const {view, firstRect} of flying) {
        animateFromRect(view.el, firstRect, FLY_BACK_DURATION)
        refreshPieceClasses(view)
        if (selectedInd === view.ind) {
            droppedSelection = true
        }
    }
    if (droppedSelection) {
        selectedInd = null
        for (const view of pieceViews) {
            refreshPieceClasses(view)
        }
    }
}


/** Send every unstable piece except the one the player just grabbed back to the piece bar. */
function sendUnstablePiecesHome(exceptInd: number) {
    sendPiecesToBar(pieceViews.filter(view =>
        view.ind !== exceptInd && view.piece.unstable && view.host === 'board'
    ))
}


// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------

function onKeyDown(event: KeyboardEvent) {
    if (isSubmitting.value || (event.key !== 'r' && event.key !== 'R')) {
        return
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) {
        return
    }
    const ind = drag ? drag.ind : selectedInd
    if (ind !== null) {
        rotatePiece(ind)
    }
}


/** Turn a piece by 90 degrees clockwise, keeping it on the board when it was placed. */
function rotatePiece(ind: number) {
    const view = pieceViews[ind]!
    const piece = view.piece
    const fromRotation = piece.rotation
    const toRotation = (fromRotation + 1) % 4

    if (view.host !== 'board') {
        // a piece in the piece bar or in the middle of a drag only turns around its center
        piece.setRotation(toRotation)
        // the turn decides how tall its slot is, so the tray is stacked again
        layoutPieceBar()
        animateRotation(view, fromRotation, fromRotation + 1)
        if (view.host === 'drag') {
            updateDropTarget(view)
        }
        return
    }

    const nextSize = piece.getRotatedSize(toRotation)
    if (!game || nextSize.width > game.numCols || nextSize.height > game.numRows) {
        // such a piece does not fit into the board at all, so the rotation is refused
        animateRefusal(view)
        return
    }

    // turn the piece around its center, then keep it inside the board
    const size = piece.getRotatedSize(fromRotation)
    const centerCol = piece.x + size.width / 2
    const centerRow = piece.y + size.height / 2
    piece.setRotation(toRotation)
    piece.x = clamp(Math.round(centerCol - nextSize.width / 2), 0, game.numCols - nextSize.width)
    piece.y = clamp(Math.round(centerRow - nextSize.height / 2), 0, game.numRows - nextSize.height)
    applyPieceStyle(view)
    animateRotation(view, fromRotation, fromRotation + 1)
    checkStability(view)
    refreshPreview()
}


// ---------------------------------------------------------------------------
// what the board is worth
// ---------------------------------------------------------------------------

/**
 * `counts[row][type]` / `counts[col][type]`: how many blocks of every type sit there now.
 *
 * A piece which is unstable is left out: it only sits on the board until the
 * next move, and what it covers is not what the player meant to deliver.
 */
function countBlocksOnBoard() {
    const rowCounts: number[][] = []
    const colCounts: number[][] = []
    if (!game) {
        return {rowCounts, colCounts}
    }

    for (let rowInd = 0; rowInd < game.numRows; rowInd++) {
        rowCounts.push(Array(game.numTypes).fill(0))
    }
    for (let colInd = 0; colInd < game.numCols; colInd++) {
        colCounts.push(Array(game.numTypes).fill(0))
    }

    const countBlock = (row: number, col: number, typeId: number) => {
        if (!game || typeId <= 0 || typeId > game.numTypes) {
            return
        }
        rowCounts[row]![typeId - 1]!++
        colCounts[col]![typeId - 1]!++
    }

    for (const view of pieceViews) {
        const piece = view.piece
        if (!piece.isPlaced || piece.unstable) {
            continue
        }
        for (const cell of piece.getBoardCells(piece.y, piece.x)) {
            countBlock(cell.row, cell.col, piece.typeId)
        }
    }
    for (const constraint of game.fixed) {
        countBlock(constraint.y, constraint.x, constraint.typeId)
    }

    return {rowCounts, colCounts}
}


/**
 * How much of what the rows and the columns ask for the board delivers.
 *
 * The difference of every row and of every column to its demand is added up into
 * one "difference index"; the satisfaction is what is left of the demands once
 * that index is paid, as a share of all the demands together. 1 is a perfect
 * answer, and the result never drops below 0.
 */
function calcSatisfaction() {
    if (!game) {
        return 0
    }
    const {rowCounts, colCounts} = countBlocksOnBoard()

    let demandTotal = 0
    let differenceTotal = 0
    const addDemand = (count: number, demand: number) => {
        demandTotal += demand
        differenceTotal += Math.abs(count - demand)
    }

    for (let rowInd = 0; rowInd < game.numRows; rowInd++) {
        for (let typeInd = 0; typeInd < game.numTypes; typeInd++) {
            addDemand(rowCounts[rowInd]?.[typeInd] ?? 0, game.rowDemands[rowInd]?.[typeInd] ?? 0)
        }
    }
    for (let colInd = 0; colInd < game.numCols; colInd++) {
        for (let typeInd = 0; typeInd < game.numTypes; typeInd++) {
            addDemand(colCounts[colInd]?.[typeInd] ?? 0, game.colDemands[colInd]?.[typeInd] ?? 0)
        }
    }

    if (demandTotal === 0) {
        return differenceTotal === 0 ? 1 : 0
    }
    return Math.max(0, (demandTotal - differenceTotal) / demandTotal)
}


/** 10 points for a perfect answer, otherwise a tenth of the satisfaction. */
function calcExpectedScore() {
    const value = calcSatisfaction()
    return roundToTwoDecimals(value >= 1 ? 10 : 0.1 * value)
}


function roundToTwoDecimals(value: number) {
    return Math.round(value * 100) / 100
}


/** Refresh the demand satisfaction and the expected score shown for the current board. */
function refreshPreview() {
    satisfaction.value = calcSatisfaction()
    expectedScore.value = calcExpectedScore()
}


/** A submission waits for the newest one to be two seconds old. */
function canSubmit() {
    return !isSubmitting.value && Date.now() - lastSubmitTime >= SUBMIT_INTERVAL
}


/**
 * Score the current board and roll the next one in: the board and the piece bar
 * fade out, the next quiz is built while they are invisible, and they fade back
 * in. A submission which is already playing, or which is younger than
 * `SUBMIT_INTERVAL`, is ignored and returns `null`.
 */
function submitAnswer(): CargoSubmitResult | null {
    if (!canSubmit()) {
        return null
    }
    cancelPress()

    const submittedSatisfaction = roundToTwoDecimals(calcSatisfaction())
    const submittedScore = calcExpectedScore()
    const submittedTotalScore = roundToTwoDecimals(totalScore.value + submittedScore)
    totalScore.value = submittedTotalScore
    lastSubmitTime = Date.now()
    // start the 2 s cooldown of the automation protocol as well: the button and a
    // player program must not be able to take turns to submit faster than that
    automationBridge.markSubmitted()
    isSubmitting.value = true
    fadePhase.value = 'out'

    clearFadeTimers()
    fadeTimerIds.push(window.setTimeout(() => {
        // the next quiz is built while the board and the piece bar are transparent
        startNextQuiz()
        fadePhase.value = 'in'

        fadeTimerIds.push(window.setTimeout(() => {
            fadePhase.value = 'idle'
            isSubmitting.value = false
            fadeTimerIds = []
        }, FADE_DURATION))
    }, FADE_DURATION))

    return {
        satisfaction: submittedSatisfaction,
        expectedScore: submittedScore,
        totalScore: submittedTotalScore,
        demandMet: submittedSatisfaction >= 1,
    }
}


function startNextQuiz() {
    initRandomQuiz()
    fitLayout()
    refreshPreview()
    automationBridge.notifyLevelStarted()
}


function clearFadeTimers() {
    for (const timerId of fadeTimerIds) {
        window.clearTimeout(timerId)
    }
    fadeTimerIds = []
}


/** Drop the press or the drag which is going on, if there is one. */
function cancelPress() {
    if (!press && !drag) {
        return
    }
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)
    if (drag) {
        // an interrupted drag puts the piece back into the piece bar
        const view = pieceViews[drag.ind]
        if (view) {
            sendPiecesToBar([view])
        }
    }
    press = null
    drag = null
    clearDropPreview()
    document.body.style.cursor = ''
    refreshPreview()
}


// ---------------------------------------------------------------------------
// automation
// ---------------------------------------------------------------------------

/** One piece as the player program sees it. */
interface CargoAutomationPiece {
    /** Index of the piece, which is what the actions name. */
    ind: number
    typeId: number
    /** Blocks of the piece, `shape[y][x]`, `1` where it has a block. */
    shape: number[][]
    width: number
    height: number
    /** `null` while the piece sits in the piece bar. */
    placement: {row: number, col: number, rotation: number} | null
    /** True while the piece overlaps another piece or a fixed constraint. */
    unstable: boolean
}

/** Everything a player program can read about the board. */
interface CargoAutomationState {
    started: boolean
    numRows: number
    numCols: number
    numTypes: number
    /** `rowDemands[rowInd][typeInd]`: how many blocks of type `typeInd + 1` the row asks for. */
    rowDemands: number[][]
    /** `colDemands[colInd][typeInd]`: how many blocks of type `typeInd + 1` the column asks for. */
    colDemands: number[][]
    /** Cells which are taken before the player starts; `typeId` `-1` means "nothing fits here". */
    fixed: {row: number, col: number, typeId: number}[]
    pieces: CargoAutomationPiece[]
    metrics: {
        /** Share of what the rows and the columns ask for which the board delivers, 0 … 1. */
        satisfaction: number
        /** What the board would score: 10 at 100%, otherwise a tenth of the satisfaction. */
        expectedScore: number
        totalScore: number
        /** True when every row and every column got what it asked for. */
        isDemandMet: boolean
    }
    /** True while the submit transition plays: buffered actions wait for it. */
    busy: boolean
}

/** One piece to put on the board, as an action carries it. */
interface CargoAutomationPlacement {
    pieceInd: number
    row: number
    col: number
    rotation: number
}

/** What a submission reports back to the player program. */
type CargoSubmitResult = {
    satisfaction: number
    expectedScore: number
    totalScore: number
    demandMet: boolean
}

/**
 * The two things a player program can do, once they are checked and understood:
 * put one or more pieces somewhere, or send every piece back into the piece bar.
 */
type CargoAutomationAction =
    | {kind: 'place', placements: CargoAutomationPlacement[]}
    | {kind: 'clear'}


function getCargoAutomationState(): CargoAutomationState {
    return {
        started: game !== null && pieceViews.length > 0,
        numRows: game?.numRows ?? 0,
        numCols: game?.numCols ?? 0,
        numTypes: game?.numTypes ?? 0,
        rowDemands: (game?.rowDemands ?? []).map(demands => [...demands]),
        colDemands: (game?.colDemands ?? []).map(demands => [...demands]),
        fixed: (game?.fixed ?? []).map(constraint => ({
            row: constraint.y,
            col: constraint.x,
            typeId: constraint.typeId,
        })),
        pieces: pieceViews.map(view => ({
            ind: view.ind,
            typeId: view.piece.typeId,
            shape: view.piece._shape.map(shapeRow => [...shapeRow]),
            width: view.piece.width,
            height: view.piece.height,
            placement: view.piece.isPlaced
                ? {row: view.piece.y, col: view.piece.x, rotation: view.piece.rotation}
                : null,
            unstable: view.piece.unstable,
        })),
        metrics: {
            satisfaction: roundToTwoDecimals(satisfaction.value),
            expectedScore: expectedScore.value,
            totalScore: totalScore.value,
            isDemandMet: isDemandMet.value,
        },
        busy: isSubmitting.value,
    }
}


/** Read a whole number out of a command field, and say what is wrong when it is not one. */
function parseCommandInteger(value: unknown, name: string, min: number, max: number) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof number !== 'number' || !Number.isInteger(number)) {
        throw new Error(`${name} must be a whole number, got ${JSON.stringify(value)}`)
    }
    if (number < min || number > max) {
        throw new Error(`${name} must be between ${min} and ${max}, got ${number}`)
    }
    return number
}


/**
 * Rotation in quarter turns. It is optional: a piece which is already on the
 * board keeps the turn it has, a piece in the piece bar is placed unturned.
 */
function parseCommandRotation(value: unknown, piece: Piece) {
    if (value === undefined || value === null) {
        return piece.isPlaced ? piece.rotation : 0
    }
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof number !== 'number' || !Number.isInteger(number)) {
        throw new Error(`rotation must be a whole number of quarter turns, got ${JSON.stringify(value)}`)
    }
    // any whole number does, `5` is the same turn as `1`
    return ((number % 4) + 4) % 4
}


function normalizeCargoPlacement(raw: unknown): CargoAutomationPlacement {
    if (!game || pieceViews.length === 0) {
        throw new Error('the board is not ready yet')
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('a placement must be an object like {"pieceInd": 0, "row": 0, "col": 0, "rotation": 0}')
    }

    const fields = raw as Record<string, unknown>
    const pieceInd = parseCommandInteger(fields.pieceInd, 'pieceInd', 0, pieceViews.length - 1)
    const piece = pieceViews[pieceInd]!.piece
    const rotation = parseCommandRotation(fields.rotation, piece)
    const size = piece.getRotatedSize(rotation)

    if (size.width > game.numCols || size.height > game.numRows) {
        throw new Error(
            `piece ${pieceInd} (${piece.width}x${piece.height}) does not fit into the `
            + `${game.numRows}x${game.numCols} board at rotation ${rotation}`,
        )
    }

    const row = parseCommandInteger(fields.row, 'row', 0, game.numRows - size.height)
    const col = parseCommandInteger(fields.col, 'col', 0, game.numCols - size.width)
    return {pieceInd, row, col, rotation}
}


/**
 * Check one action and turn it into its internal shape. Four spellings are
 * understood, so a player program can write whichever reads best:
 *
 *     { "kind": "place", "pieces": [ {"pieceInd": 0, "row": 0, "col": 0, "rotation": 0}, ... ] }
 *     { "kind": "place", "pieceInd": 0, "row": 0, "col": 0, "rotation": 1 }
 *     { "pieceInd": 0, "row": 0, "col": 0 }                       // "place" is the default
 *     { "kind": "clear" }                                         // every piece back into the bar
 */
function normalizeCargoAction(raw: unknown): CargoAutomationAction {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('an action must be an object like {"kind": "clear"}')
    }

    const fields = raw as Record<string, unknown>
    const kind = fields.kind
        ?? (Array.isArray(fields.pieces) || fields.pieceInd !== undefined ? 'place' : undefined)

    if (kind === 'clear') {
        return {kind: 'clear'}
    }
    if (kind === 'place') {
        const rawPlacements = Array.isArray(fields.pieces) ? fields.pieces : [fields]
        if (rawPlacements.length === 0) {
            throw new Error('a "place" action carries no piece, send at least one "pieces" entry')
        }
        return {kind: 'place', placements: rawPlacements.map(normalizeCargoPlacement)}
    }
    throw new Error(
        `unknown action ${JSON.stringify(raw)}, expected {"kind": "place", ...} or {"kind": "clear"}`,
    )
}


/**
 * Play one action on the board.
 *
 * A piece is put on the board even when it lands on top of something else: it
 * glows red and counts as unstable, exactly like a piece the player dropped
 * there. What earlier moves left unstable goes back into the piece bar with
 * this move, unless this move is about those pieces anyway.
 */
function applyCargoAction(action: CargoAutomationAction) {
    if (action.kind === 'clear') {
        // nothing may stay in the middle of a drag while the tray is refilled
        cancelPress()
        sendPiecesToBar(pieceViews.filter(view => view.piece.isPlaced))
        refreshPreview()
        return
    }

    // a placement of the very piece the player is holding would fight with the drag
    if (drag && action.placements.some(placement => placement.pieceInd === drag?.ind)) {
        cancelPress()
    }

    const placing = new Set(action.placements.map(placement => placement.pieceInd))
    sendPiecesToBar(pieceViews.filter(view => view.piece.unstable && !placing.has(view.ind)))

    for (const placement of action.placements) {
        const view = pieceViews[placement.pieceInd]
        if (!view) {
            continue
        }
        const piece = view.piece
        const firstRect = view.el.getBoundingClientRect()
        const fromRotation = piece.rotation

        piece.setRotation(placement.rotation)
        piece.x = placement.col
        piece.y = placement.row
        attachToBoard(view)
        applyPieceStyle(view)
        // the piece flies to where it was told to go, exactly like a piece the player
        // dropped, so that a player program is as pleasant to watch as a real player
        animateFromRect(view.el, firstRect, PIECE_MOVE_DURATION)
        if (fromRotation !== piece.rotation) {
            animateRotation(view, fromRotation, fromRotation + getClockwiseTurns(fromRotation, piece.rotation))
        }
        checkStability(view)
    }
    refreshPreview()
}


/**
 * The cargo game's adapter for the shared automation protocol. Everything
 * protocol related (connection, retries, action buffer, rate limits) lives in
 * `GameAutomationBridge`, this object only touches the board.
 */
const automationBridge = new GameAutomationBridge<CargoAutomationAction, CargoAutomationState>({
    gameId: 'cargo',

    getState() {
        return getCargoAutomationState()
    },

    describeLevel() {
        return {
            numRows: game?.numRows ?? 0,
            numCols: game?.numCols ?? 0,
            numTypes: game?.numTypes ?? 0,
            numPieces: pieceViews.length,
            actionKinds: ['place', 'clear'],
            placeFields: {pieceInd: 'int', row: 'int', col: 'int', rotation: 'int | omitted'},
        }
    },

    normalizeAction(raw) {
        return normalizeCargoAction(raw)
    },

    applyAction(action) {
        applyCargoAction(action)
    },

    canApplyAction() {
        return !isSubmitting.value
    },

    canSubmit() {
        return canSubmit()
    },

    submit() {
        const result = submitAnswer()
        if (!result) {
            throw new Error('a submission is already in progress')
        }
        return {...result}
    },
})


// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
    startNextQuiz()
    window.addEventListener('resize', fitLayout)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onEmptyRoomMouseDown)
    // releasing the mouse outside of the window does not reach the page: drop the piece instead
    window.addEventListener('blur', onWindowMouseUp)
    // dial the player's automation program, retrying once per second
    automationBridge.connect()
})


onBeforeUnmount(() => {
    window.removeEventListener('resize', fitLayout)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('mousedown', onEmptyRoomMouseDown)
    window.removeEventListener('blur', onWindowMouseUp)
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)
    clearFadeTimers()
    automationBridge.dispose()
    document.body.style.cursor = ''
})
</script>


<template>
    <div ref="boardArea" class="board-area" :class="fadeClass">
        <div ref="colLabelStrip" class="label-strip col-label-strip"></div>
        <div ref="rowLabelStrip" class="label-strip row-label-strip"></div>
        <div ref="gridArea" class="grid-area">
            <div ref="pieceLayer" class="piece-layer"></div>
        </div>
    </div>
    <div ref="pieceBar" class="piece-bar" :class="fadeClass">
        <div ref="pieceBarHint" class="piece-bar-hint">鼠标拖拽、R键旋转</div>
        <div ref="pieceBarList" class="piece-bar-list"></div>
    </div>
    <div ref="dragLayer" class="drag-layer"></div>
    <div class="score-area">
        <div class="score-label">总得分</div>
        <div class="score-value">{{ totalScoreText }}</div>
    </div>
    <div class="submit-area">
        <div class="demand-preview" :class="{ 'is-demand-met': isDemandMet }">
            <div class="preview-row">
                <span class="preview-label">需求满足度</span>
                <span class="preview-value">{{ satisfactionText }}</span>
            </div>
            <div class="preview-row">
                <span class="preview-label">预期得分</span>
                <span class="preview-value">{{ expectedScoreText }}</span>
            </div>
        </div>
        <button class="submit-button" :disabled="isSubmitting" @click="submitAnswer">提交</button>
    </div>
    <GameAutomationPanel :bridge="automationBridge" />
    <audio src="/music/Piece and Piece.mp3" autoplay loop></audio>
</template>


<style>
html {
    background-color: #b27f00;
}

.board-area {
    position: fixed;
}

/* --- what every row and every column asks for --- */

.label-strip {
    position: absolute;
    display: grid;
}

.constraint-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: var(--label-icon-gap);
    padding-right: var(--label-padding);
}

.constraint-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: var(--label-icon-gap);
    padding-bottom: var(--label-padding);
}

.constraint-item {
    position: relative;
    width: var(--label-icon-size);
    height: var(--label-icon-size);
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    filter: drop-shadow(0 1px 2px rgba(60, 30, 0, 0.5));
}

.constraint-demand {
    position: absolute;
    right: -0.14em;
    bottom: -0.14em;
    font-family: 'Ruantang', sans-serif;
    font-size: calc(var(--label-icon-size) * 0.48);
    line-height: 1;
    color: #fff8e6;
    text-shadow:
        0 0 3px #4a2a00, 0 0 3px #4a2a00,
        1px 1px 0 #4a2a00, -1px 1px 0 #4a2a00,
        1px -1px 0 #4a2a00, -1px -1px 0 #4a2a00;
}

/* --- the board --- */

.grid-area {
    position: absolute;
    display: grid;
}

.board-cell {
    position: relative;
    box-sizing: border-box;
    border: 2px dashed rgba(255, 244, 214, 0.32);
    border-radius: 8px;
    background-color: rgba(96, 64, 16, 0.26);
}

.board-cell.is-drop-target {
    border-color: rgba(255, 248, 222, 0.95);
    background-color: rgba(255, 248, 222, 0.22);
}

.board-cell.is-drop-conflict {
    border-color: rgba(255, 104, 104, 0.95);
    background-color: rgba(255, 66, 66, 0.28);
}

.board-cell.is-fixed {
    border: 2px solid rgba(255, 214, 110, 0.95);
    background-color: rgba(255, 214, 110, 0.2);
}

.board-cell.is-void {
    border: 2px solid rgba(52, 30, 6, 0.65);
    background-color: rgba(38, 22, 4, 0.5);
}

.board-cell.is-void::after {
    content: '✕';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: calc(var(--block-size) * 0.5);
    color: rgba(255, 226, 180, 0.5);
}

.cell-icon {
    position: absolute;
    inset: 11%;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    filter: drop-shadow(0 1px 2px rgba(60, 30, 0, 0.45));
}

.piece-layer {
    position: absolute;
    inset: 0;
}

/* --- the pieces --- */

.piece {
    position: absolute;
    /* the animations move a piece by translating and scaling it around its center */
    transform-origin: 50% 50%;
    will-change: transform;
    /* the outline of a piece, shared by its blocks and by the bridges between them */
    --piece-outline: rgba(255, 246, 214, 0.62);
    /* one shadow for the whole piece: shadows on every block would shade the inside */
    filter: drop-shadow(0 2px 5px rgba(60, 30, 0, 0.35));
    /* the empty room of a bounding box must not swallow clicks meant for a neighbor */
    pointer-events: none;
}

.piece-body {
    position: absolute;
    inset: 0;
    transform-origin: 50% 50%;
    will-change: transform;
}

.piece-cell {
    position: absolute;
    box-sizing: border-box;
    /* border: 2px solid var(--piece-outline); */
    border-radius: 9px;
    background-color: #492e05;
    background-image: url('/images/it/box.png');
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    /* the blocks switch the mouse back on, they are what the player grabs */
    pointer-events: auto;
    cursor: grab;
}

/* the brown patches which turn the blocks of a piece into one chunk */
.piece-bridge {
    position: absolute;
    box-sizing: border-box;
    background-color: #492e05;
    /* only the sides which face out of the piece are painted, from the script */
    border: 2px solid transparent;
    pointer-events: auto;
    cursor: grab;
}

.piece.is-selected {
    filter:
        drop-shadow(0 2px 5px rgba(60, 30, 0, 0.35))
        drop-shadow(0 0 4px rgba(255, 255, 255, 0.95))
        drop-shadow(0 0 12px rgba(255, 240, 168, 0.85));
    z-index: 5;
}

.piece.is-unstable {
    --piece-outline: #ff6a6a;
    z-index: 4;
}

/* the glow sits on the rotated part of the piece: a glow has no direction, so unlike
   the shadow of the piece it does not have to stay upright */
.piece.is-unstable .piece-body {
    animation: unstable-glow 620ms ease-in-out infinite alternate;
}

@keyframes unstable-glow {
    from {
        filter: drop-shadow(0 0 3px rgba(255, 64, 64, 0.75));
    }
    to {
        filter: drop-shadow(0 0 14px rgba(255, 32, 32, 1));
    }
}

/* --- the piece bar --- */

.piece-bar {
    position: fixed;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    border-radius: 18px;
    background-color: #7a5512;
    box-shadow: inset 0 2px 18px rgba(0, 0, 0, 0.35), 0 4px 14px rgba(60, 30, 0, 0.4);
    overflow-y: hidden;
    overflow-x: visible;
}

.piece-bar-list {
    flex: 1;
    display: grid;
    /* the slots are placed from the top left on purpose: the script centers them with
       whole pixels, which is what keeps every piece of the bar sharp */
    justify-content: start;
    align-content: start;
    scrollbar-gutter: stable;
    overflow-x: hidden;
    overflow-y: auto;
}

/* the two rules of the game, in the strip the pieces leave free at the top */
.piece-bar-hint {
    flex: none;
    padding: min(1.6vh, 16px) 8px min(1vh, 10px);
    font-family: 'Ruantang', sans-serif;
    font-size: min(1.3vw, 2vh);
    line-height: 1.3;
    text-align: center;
    color: #ffeec6;
    text-shadow: 0 1px 2px rgba(60, 30, 0, 0.6);
    box-shadow: inset 0 -1px 0 rgba(255, 240, 205, 0.18);
}

.piece-bar-list::-webkit-scrollbar {
    width: 8px;
}

.piece-bar-list::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background-color: rgba(255, 240, 205, 0.28);
}

.piece-slot {
    position: relative;
    box-sizing: border-box;
    border-radius: 12px;
    /* the slots are as wide as their own piece, the column is as wide as the widest one */
    justify-self: center;
}

.piece-slot:not(.is-occupied) {
    border: 1px dashed rgba(255, 240, 205, 0.18);
}

/* --- the layer the dragged piece lives in --- */

.drag-layer {
    position: fixed;
    inset: 0;
    /* the layer is only a coordinate system, the mouse events belong to the game below it */
    pointer-events: none;
    z-index: 900;
}

/* --- the submit transition --- */

@keyframes fade-out {
    from { opacity: 1; }
    to { opacity: 0; }
}

@keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
}

.is-fading-out {
    pointer-events: none;
    /* keep the duration in sync with FADE_DURATION in the script */
    animation: fade-out 1000ms ease-in forwards;
}

.is-fading-in {
    animation: fade-in 1000ms ease-out forwards;
}

/* --- the score and the submit button --- */

.score-area {
    position: fixed;
    right: min(2.5vw, 2.5vh);
    top: min(2.5vw, 2.5vh);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: min(1.4vh, 14px);
}

.score-label {
    font-family: 'Ruantang', sans-serif;
    font-size: min(2.2vw, 3.4vh);
    line-height: 1.1;
    color: #fff6e0;
    text-shadow: 0 1px 2px rgba(90, 50, 0, 0.6);
}

.score-value {
    font-family: 'Ruantang', sans-serif;
    font-size: min(3.2vw, 5vh);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(90, 50, 0, 0.6);
}

.submit-area {
    position: fixed;
    right: min(2.5vw, 2.5vh);
    bottom: min(2.5vw, 2.5vh);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: min(2vh, 20px);
}

.demand-preview {
    display: flex;
    flex-direction: column;
    gap: min(0.8vh, 8px);
    font-family: 'Ruantang', sans-serif;
    /* keep this in sync with PANEL_FONT_*_RATIO in the script: the room the board
       keeps free for the panel is computed from the same numbers */
    /* the same size as the preview of the baking game */
    font-size: min(1.8vw, 2.8vh);
    line-height: 1.2;
    color: #fff6e0;
    text-shadow: 0 1px 2px rgba(90, 50, 0, 0.6);
}

.preview-row {
    display: flex;
    justify-content: flex-end;
    gap: 1em;
}

.preview-value {
    min-width: 5em;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: #ffffff;
}

/* every row and every column got what it asked for */
.demand-preview.is-demand-met {
    color: #9dffb6;
    text-shadow: 0 0 6px rgba(70, 255, 128, 0.95), 0 0 16px rgba(33, 201, 79, 0.75);
    transform-origin: 100% 50%;
    animation: demand-met-pop 600ms ease-out 1;
}

.demand-preview.is-demand-met .preview-value {
    color: #ddffe5;
}

@keyframes demand-met-pop {
    0% { transform: scale(1); }
    35% { transform: scale(1.16); }
    65% { transform: scale(0.97); }
    100% { transform: scale(1); }
}

.submit-button {
    font-family: 'Ruantang', sans-serif;
    font-size: min(2.6vw, 3.8vh);
    line-height: 1.1;
    padding: 0.4em 1.2em;
    color: #7c3200;
    background-color: #ffe9b3;
    border: none;
    border-radius: 999px;
    box-shadow: 0 3px 0 rgba(124, 50, 0, 0.5);
    cursor: pointer;
}

.submit-button:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 rgba(124, 50, 0, 0.5);
}

.submit-button:disabled {
    opacity: 0.55;
    box-shadow: none;
    cursor: not-allowed;
}
</style>
