<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

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
/** The piece bar switches from one to two columns as soon as it is this wide, in px. */
const PIECE_BAR_TWO_COLUMNS_WIDTH = 200
/** The pieces of the piece bar are always drawn smaller than the blocks of the board. */
const PIECE_BAR_MAX_SCALE = 0.62
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
const ROTATE_DURATION = 170

/**
 * The item drawn for every block type, in the order the types are numbered:
 * type 1 uses the first image, type 2 the second one, and so on.
 */
const ITEM_IMAGE_LIST = [
    // '/images/it/flour.png',
    // '/images/it/water_bucket.png',
    '/images/it/raspberry_cake_transparent.png',
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
    cells: {el: HTMLDivElement, icon: HTMLDivElement, x: number, y: number}[]
    /** `.piece-slot`: the square the piece owns in the piece bar, empty while the piece is on the board. */
    slot: HTMLDivElement
    /** Where the element of the piece currently lives. */
    host: 'bar' | 'board' | 'drag'
    /** Center of the piece in viewport coordinates, only used while it is being dragged. */
    centerX: number
    centerY: number
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
let barScale = 1
let slotSize = 0

const boardArea = ref<HTMLDivElement | null>(null)
const gridArea = ref<HTMLDivElement | null>(null)
const pieceLayer = ref<HTMLDivElement | null>(null)
const rowLabelStrip = ref<HTMLDivElement | null>(null)
const colLabelStrip = ref<HTMLDivElement | null>(null)
const pieceBar = ref<HTMLDivElement | null>(null)
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


/** Width of a piece as it is drawn on the board, in px. */
function getPieceBoxWidth(piece: Piece) {
    return piece.width * cellPitch - CELL_GAP
}


/** Height of a piece as it is drawn on the board, in px. */
function getPieceBoxHeight(piece: Piece) {
    return piece.height * cellPitch - CELL_GAP
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

    const cells = piece.getShapeCells().map(cell => {
        const cellEl = document.createElement('div')
        cellEl.className = 'piece-cell'

        const icon = document.createElement('div')
        icon.className = 'cell-icon'
        icon.style.backgroundImage = `url("${getItemImage(piece.typeId)}")`
        cellEl.appendChild(icon)
        body.appendChild(cellEl)

        // the mouse listens on the blocks themselves: the empty room inside the bounding box
        // of a piece must never swallow a click which belongs to a neighboring piece
        cellEl.addEventListener('mousedown', (event) => onPieceMouseDown(ind, event))

        return {el: cellEl, icon, x: cell.x, y: cell.y}
    })

    const slot = document.createElement('div')
    slot.className = 'piece-slot'

    return {ind, piece, el, body, cells, slot, host: 'bar', centerX: 0, centerY: 0}
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
    const margin = clamp(Math.min(viewWidth, viewHeight) * SCREEN_MARGIN_RATIO, 12, 48)
    const barWidth = clamp(viewWidth * PIECE_BAR_WIDTH_RATIO, MIN_PIECE_BAR_WIDTH, MAX_PIECE_BAR_WIDTH)
    const barBoardGap = Math.max(margin, 16)

    // the board is a square, so the block size is limited by the width and by the height
    const labelRatio = getLabelThicknessRatio(game.numTypes) + LABEL_EDGE_RATIO
    const availableWidth = viewWidth - margin * 2 - barWidth - barBoardGap
    const availableHeight = viewHeight - margin * 2
    blockSize = clamp(Math.min(
        (availableWidth - (game.numCols - 1) * CELL_GAP) / (game.numCols + labelRatio),
        (availableHeight - (game.numRows - 1) * CELL_GAP) / (game.numRows + labelRatio),
    ), MIN_BLOCK_SIZE, MAX_BLOCK_SIZE)
    cellPitch = blockSize + CELL_GAP

    const labelIconSize = blockSize * LABEL_ICON_RATIO
    const labelIconGap = blockSize * LABEL_ICON_GAP_RATIO
    const labelPadding = blockSize * LABEL_PADDING_RATIO
    const labelEdge = blockSize * LABEL_EDGE_RATIO
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
    const areaWidth = viewWidth - margin - areaLeft
    boardArea.value.style.left = `${areaLeft + (areaWidth - areaInset - boardWidth) / 2}px`
    boardArea.value.style.top = `${(viewHeight - areaInset - boardHeight) / 2}px`
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

    // the pieces of the piece bar are scaled down until they fit into their slots
    const barPadding = Math.max(8, barWidth * 0.08)
    const slotGap = Math.max(6, barWidth * 0.06)
    const barCols = barWidth >= PIECE_BAR_TWO_COLUMNS_WIDTH ? 2 : 1
    slotSize = (barWidth - barPadding * 2 - slotGap * (barCols - 1)) / barCols
    const widestPiece = pieceViews.reduce((widest, view) => Math.max(
        widest,
        getPieceBoxWidth(view.piece),
        getPieceBoxHeight(view.piece),
    ), 0)
    barScale = widestPiece > 0
        ? Math.min(PIECE_BAR_MAX_SCALE, (slotSize - 8) / widestPiece)
        : PIECE_BAR_MAX_SCALE
    pieceBarList.value.style.gridTemplateColumns = `repeat(${barCols}, ${slotSize}px)`
    pieceBarList.value.style.gap = `${slotGap}px`
    pieceBarList.value.style.padding = `${barPadding}px`

    for (const view of pieceViews) {
        view.slot.style.width = `${slotSize}px`
        view.slot.style.height = `${slotSize}px`
        applyPieceStyle(view)
    }
}


/** Move the element of a piece to where its current host expects it to be. */
function applyPieceStyle(view: PieceView) {
    const piece = view.piece
    const boxWidth = getPieceBoxWidth(piece)
    const boxHeight = getPieceBoxHeight(piece)

    view.el.style.width = `${boxWidth}px`
    view.el.style.height = `${boxHeight}px`
    for (const cell of view.cells) {
        cell.el.style.left = `${cell.x * cellPitch}px`
        cell.el.style.top = `${cell.y * cellPitch}px`
        cell.el.style.width = `${blockSize}px`
        cell.el.style.height = `${blockSize}px`
    }

    view.body.style.transform = `rotate(${piece.rotation * 90}deg) scale(${view.host === 'bar' ? barScale : 1})`
    // the item of a block keeps its own direction: it is turned the other way around
    for (const cell of view.cells) {
        cell.icon.style.transform = `rotate(${piece.rotation * -90}deg)`
    }

    if (view.host === 'bar') {
        view.el.style.left = `${(slotSize - boxWidth) / 2}px`
        view.el.style.top = `${(slotSize - boxHeight) / 2}px`
    } else if (view.host === 'board') {
        // the piece turns around the center of its bounding box, which therefore may stick
        // out of the box itself: the element is shifted by half of that difference
        const size = piece.getRotatedSize()
        view.el.style.left = `${(piece.x - (piece.width - size.width) / 2) * cellPitch}px`
        view.el.style.top = `${(piece.y - (piece.height - size.height) / 2) * cellPitch}px`
    } else {
        view.el.style.left = `${view.centerX - boxWidth / 2}px`
        view.el.style.top = `${view.centerY - boxHeight / 2}px`
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


/** Turn a piece by 90 degrees clockwise, starting from where it was drawn before. */
function animateRotation(view: PieceView, fromTurns: number, toTurns: number) {
    const scale = view.host === 'bar' ? barScale : 1
    cancelAnimations(view.body)
    view.body.animate(
        [
            {transform: `rotate(${fromTurns * 90}deg) scale(${scale})`},
            {transform: `rotate(${toTurns * 90}deg) scale(${scale})`},
        ],
        {duration: ROTATE_DURATION, easing: 'ease-out'},
    )
    // the items counter-rotate in step with the piece, so that they stay upright all along
    for (const cell of view.cells) {
        cancelAnimations(cell.icon)
        cell.icon.animate(
            [
                {transform: `rotate(${fromTurns * -90}deg)`},
                {transform: `rotate(${toTurns * -90}deg)`},
            ],
            {duration: ROTATE_DURATION, easing: 'ease-out'},
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
    if (event.button !== 0 || !game) {
        return
    }
    event.preventDefault()

    // touching a piece settles the board: the other unstable pieces fly back to the piece bar
    sendUnstablePiecesHome(ind)
    select(ind)

    press = {ind, startX: event.clientX, startY: event.clientY}
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)
}


/** Clicking the board itself, rather than a piece, drops the selection. */
function onBoardMouseDown(event: MouseEvent) {
    const target = event.target as HTMLElement | null
    if (target?.closest('.board-cell')) {
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

    // the piece grows from its size in the piece bar to its size on the board, so the spot
    // the player grabbed is remembered as a fraction of the piece instead of a distance
    const fractionX = firstRect.width > 0
        ? (event.clientX - firstRect.left) / firstRect.width - 0.5
        : 0
    const fractionY = firstRect.height > 0
        ? (event.clientY - firstRect.top) / firstRect.height - 0.5
        : 0

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
        sendToBar(view, firstRect)
        if (selectedInd === view.ind) {
            select(null)
        }
    }
}


function sendToBar(view: PieceView, firstRect?: DOMRect) {
    view.piece.unstable = false
    view.piece.x = -1
    view.piece.y = -1
    attachToBar(view)
    // the slot has to be on screen before the place the piece flies to can be measured
    view.slot.scrollIntoView({block: 'nearest'})
    applyPieceStyle(view)
    refreshPieceClasses(view)

    if (firstRect) {
        animateFromRect(view.el, firstRect, FLY_BACK_DURATION)
    }
}


/** Send every unstable piece except the one the player just grabbed back to the piece bar. */
function sendUnstablePiecesHome(exceptInd: number) {
    let droppedSelection = false
    for (const view of pieceViews) {
        if (view.ind === exceptInd || !view.piece.unstable || view.host !== 'board') {
            continue
        }
        sendToBar(view, view.el.getBoundingClientRect())
        if (selectedInd === view.ind) {
            selectedInd = null
            droppedSelection = true
        }
    }
    if (droppedSelection) {
        for (const view of pieceViews) {
            refreshPieceClasses(view)
        }
    }
}


// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------

function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'r' && event.key !== 'R') {
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
        applyPieceStyle(view)
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
}


// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
    initRandomQuiz()
    fitLayout()
    window.addEventListener('resize', fitLayout)
    window.addEventListener('keydown', onKeyDown)
    // releasing the mouse outside of the window does not reach the page: drop the piece instead
    window.addEventListener('blur', onWindowMouseUp)
})


onBeforeUnmount(() => {
    window.removeEventListener('resize', fitLayout)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('blur', onWindowMouseUp)
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)
    document.body.style.cursor = ''
})
</script>


<template>
    <div ref="boardArea" class="board-area">
        <div ref="colLabelStrip" class="label-strip col-label-strip"></div>
        <div ref="rowLabelStrip" class="label-strip row-label-strip"></div>
        <div ref="gridArea" class="grid-area" @mousedown="onBoardMouseDown">
            <div ref="pieceLayer" class="piece-layer"></div>
        </div>
    </div>
    <div ref="pieceBar" class="piece-bar">
        <div ref="pieceBarList" class="piece-bar-list"></div>
    </div>
    <div ref="dragLayer" class="drag-layer"></div>
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
    border: 2px solid rgba(255, 246, 214, 0.62);
    border-radius: 9px;
    background-color: #c98b3f;
    background-image: url('/images/it/box.png');
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    box-shadow: 0 2px 6px rgba(60, 30, 0, 0.35);
    /* the blocks switch the mouse back on, they are what the player grabs */
    pointer-events: auto;
    cursor: grab;
}

.piece.is-selected {
    filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.95)) drop-shadow(0 0 12px rgba(255, 240, 168, 0.85));
    z-index: 5;
}

.piece.is-unstable {
    z-index: 4;
}

.piece.is-unstable .piece-cell {
    border-color: #ff6a6a;
    animation: unstable-glow 620ms ease-in-out infinite alternate;
}

@keyframes unstable-glow {
    from {
        box-shadow: 0 0 6px 1px rgba(255, 72, 72, 0.7), 0 2px 6px rgba(60, 30, 0, 0.35);
    }
    to {
        box-shadow: 0 0 18px 6px rgba(255, 32, 32, 0.95), 0 2px 6px rgba(60, 30, 0, 0.35);
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
    justify-content: center;
    align-content: safe center;
    overflow-x: hidden;
    overflow-y: auto;
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
</style>
