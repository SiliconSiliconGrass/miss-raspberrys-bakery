<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import BakingBoard from './BakingBoard';
import QuizGenerator from './QuizGenerator';
import {
    GameAutomationBridge,
    GameAutomationPanel,
    type AutomationBoardSnapshot,
} from '../../automation';
import BackHomeButton from '../../components/BackHomeButton.vue';
import { assetUrl } from '../../utils/asset';
import { getBackHomeRoom, isPhoneScreen, setPhoneLayoutFlag } from '../../utils/layout';

/** Background music of this game, loaded from wherever the app is served. */
const BGM_SRC = assetUrl('music/ms1.mp3')

/** One automation action: tapping the card at `rowInd` / `colInd`. */
type BakingTapAction = {
    rowInd: number
    colInd: number
}


const CARD_CLASS_NAME_DICT: Record<number, string> =  {
    0: 'card water-bucket',
    1: 'card flour',
}

const QUIZ_CARD_GAP = 10 // px
const BOARD_MARGIN_RATIO = 0.05 // ratio of the shorter screen edge
const QUIZ_HORIZONTAL_MARGIN_RATIO = 0.25 // per side, of the viewport width
const ANSWER_AREA_CLEARANCE = 24 // px between the answer area and the quiz area
const FADE_DURATION = 1000 // ms, the submit transition takes 2 of these (2s in total)
/** Room between two cards of the target board, in px. */
const ANSWER_CARD_GAP = 2
/** Phone layout: free space kept around everything, as a ratio of the shortest screen edge. */
const PHONE_MARGIN_RATIO = 0.03
/** Phone layout: the target board is this share of the play board, a little smaller than it. */
const PHONE_ANSWER_RATIO = 0.72
/** Phone layout: room kept under the play board, in px, when the bottom bar cannot be measured. */
const PHONE_MIN_BOTTOM_ROOM = 96


let quizBoard: BakingBoard | null = null
let answerBoard: BakingBoard | null = null

const totalScore = ref(0)
const similarity = ref(0)
const expectedScore = ref(0)

const isSubmitting = ref(false)
const fadePhase = ref<'idle' | 'out' | 'in'>('idle')
let fadeTimerIds: number[] = []

const similarityText = computed(() => `${(similarity.value * 100).toFixed(2)}%`)
const expectedScoreText = computed(() => expectedScore.value.toFixed(2))
const isPerfectMatch = computed(() => similarity.value === 1)

const quizCardArea = ref<HTMLDivElement | null>(null)
const answerCardArea = ref<HTMLDivElement | null>(null)
const answerArea = ref<HTMLDivElement | null>(null)
const answerLabel = ref<HTMLDivElement | null>(null)
const submitArea = ref<HTMLDivElement | null>(null)

/** True while the screen is laid out the phone way: a portrait screen. */
const isPhone = ref(isPhoneScreen())
// already marked on the way in, so that the first frame is not drawn in the wrong shape
setPhoneLayoutFlag('baking', isPhone.value)


/**
 * Size the two boards for the shape of the screen: a portrait screen gets the
 * phone layout, every other screen the wide one.
 */
function fitQuizCardArea() {
    if (!quizBoard || !quizCardArea.value) {
        return
    }

    const nextIsPhone = isPhoneScreen()
    isPhone.value = nextIsPhone
    setPhoneLayoutFlag('baking', nextIsPhone)
    if (nextIsPhone) {
        fitPhoneQuizCardArea()
    } else {
        fitWideQuizCardArea()
    }
}


/**
 * The wide layout: the target recipe in the top left corner, the play board in
 * the middle of the screen. The play board is sized so that it always fits with
 * a margin: more than 25vw of free space on each side, and no overlap with the
 * target recipe.
 */
function fitWideQuizCardArea() {
    if (!quizBoard || !quizCardArea.value) {
        return
    }

    // the phone layout sizes and moves these two, the wide one leaves them to the
    // style: cleared before anything is measured, so that the measuring sees the
    // wide layout
    quizCardArea.value.style.top = ''
    quizCardArea.value.style.maxWidth = ''
    if (answerCardArea.value) {
        answerCardArea.value.style.width = ''
    }

    const numRows = quizBoard.numRows
    const numCols = quizBoard.numCols

    const verticalMargin = Math.max(Math.min(window.innerWidth, window.innerHeight) * BOARD_MARGIN_RATIO, 16)
    // the answer area sits at the top-left, the board is centered horizontally,
    // so clearing its right edge is enough to keep the two from overlapping
    const answerAreaRight = answerArea.value?.getBoundingClientRect().right ?? 0
    const horizontalMargin = Math.max(
        window.innerWidth * QUIZ_HORIZONTAL_MARGIN_RATIO + 2,
        answerAreaRight + ANSWER_AREA_CLEARANCE,
        16,
    )

    const availWidth = window.innerWidth - horizontalMargin * 2
    const availHeight = window.innerHeight - verticalMargin * 2

    // cards are square, so the card size is bounded by both the width and the height budget
    const cardSize = Math.min(
        (availWidth - (numCols - 1) * QUIZ_CARD_GAP) / numCols,
        (availHeight - (numRows - 1) * QUIZ_CARD_GAP) / numRows,
    )

    quizCardArea.value.style.width = `${cardSize * numCols + (numCols - 1) * QUIZ_CARD_GAP}px`
}


/**
 * The phone layout: the target board on top of the screen, the play board under
 * it, both in one column. The play board gets what is left of the screen, and
 * the target board is a little smaller than it.
 */
function fitPhoneQuizCardArea() {
    if (!quizBoard || !answerBoard || !quizCardArea.value || !answerCardArea.value) {
        return
    }

    const viewWidth = window.innerWidth
    const viewHeight = window.innerHeight
    const numRows = quizBoard.numRows
    const numCols = quizBoard.numCols
    const margin = Math.round(clamp(Math.min(viewWidth, viewHeight) * PHONE_MARGIN_RATIO, 10, 22))
    const gap = Math.max(10, margin)
    // the back-to-home button sits in the top left corner, the total score in the right one
    const topRoom = getBackHomeRoom(viewWidth, viewHeight)
    // the preview and the submit button sit in the bottom right corner
    const bottomRoom = Math.max(
        (submitArea.value?.offsetHeight ?? 0) + margin,
        PHONE_MIN_BOTTOM_ROOM,
    )
    const answerLabelHeight = answerLabel.value?.offsetHeight ?? 0
    const freeHeight = Math.max(160, viewHeight - topRoom - bottomRoom)
    const availWidth = viewWidth - margin * 2

    // the two boards are sized together: a smaller target board leaves the play
    // board more room, which allows a bigger target board again, so it takes a few
    // passes before both of them settle
    let answerCardSize = (availWidth * PHONE_ANSWER_RATIO - (numCols - 1) * ANSWER_CARD_GAP) / numCols
    let playCardSize = answerCardSize
    for (let pass = 0; pass < 3; pass++) {
        const answerHeight = numRows * answerCardSize + (numRows - 1) * ANSWER_CARD_GAP
        const playHeight = freeHeight - answerLabelHeight - gap - answerHeight
        playCardSize = Math.max(12, Math.min(
            (availWidth - (numCols - 1) * QUIZ_CARD_GAP) / numCols,
            (playHeight - (numRows - 1) * QUIZ_CARD_GAP) / numRows,
        ))
        answerCardSize = Math.min(answerCardSize, playCardSize * PHONE_ANSWER_RATIO)
    }

    const answerHeight = numRows * answerCardSize + (numRows - 1) * ANSWER_CARD_GAP
    const playWidth = playCardSize * numCols + (numCols - 1) * QUIZ_CARD_GAP
    const playHeight = playCardSize * numRows + (numRows - 1) * QUIZ_CARD_GAP

    answerCardArea.value.style.width = `${Math.round(
        answerCardSize * numCols + (numCols - 1) * ANSWER_CARD_GAP,
    )}px`
    quizCardArea.value.style.width = `${Math.round(playWidth)}px`
    quizCardArea.value.style.maxWidth = 'none'

    // the play board is centered in the room which is left under the target board
    const bandTop = topRoom + answerLabelHeight + answerHeight + gap
    const bandHeight = Math.max(playHeight, viewHeight - bottomRoom - bandTop)
    quizCardArea.value.style.top = `${Math.round(bandTop + bandHeight / 2)}px`
}


function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}


function setAnswerCardArea() {
    const numRows = answerBoard!.numRows
    const numCols = answerBoard!.numCols
    const cards: HTMLDivElement[] = []

    if (answerCardArea.value) {
        answerCardArea.value.style.display = 'grid'
        answerCardArea.value.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`
        answerCardArea.value.style.gap = `${ANSWER_CARD_GAP}px`
    }
    
    for (let i = 0; i < numRows; i++) {
        for (let j = 0; j < numCols; j++) {
            const card = document.createElement('div')
            card.id = `answer_card_${i}_${j}`
            card.className = 'card'
            card.style.aspectRatio = '1 / 1'
            card.style.width = '100%'
            card.className = CARD_CLASS_NAME_DICT[answerBoard?.getMatrix()[i]![j]!] as string
            cards.push(card)
        }
    }
    
    answerCardArea.value?.replaceChildren(...cards)
}


function setQuizCardArea() {
    const numRows = quizBoard!.numRows
    const numCols = quizBoard!.numCols
    const cards: HTMLDivElement[] = []

    if (quizCardArea.value) {
        quizCardArea.value.style.display = 'grid'
        quizCardArea.value.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`
        quizCardArea.value.style.gap = `${QUIZ_CARD_GAP}px`
    }
    
    for (let i = 0; i < numRows; i++) {
        for (let j = 0; j < numCols; j++) {
            const card = document.createElement('div')
            card.id = `quiz_card_${i}_${j}`
            card.className = 'card'
            card.style.aspectRatio = '1 / 1'
            card.style.width = '100%'
            card.className = CARD_CLASS_NAME_DICT[quizBoard?.getMatrix()[i]![j]!] as string

            // a pointer covers the mouse and the finger of a phone alike
            card.addEventListener("pointerdown", () => {
                quizBoard!.tapAt(i, j)
                refreshPreview()
            })

            cards.push(card)
        }
    }
    
    quizCardArea.value?.replaceChildren(...cards)
}


let animationCardAngleTargetCache: number[][] | null = null
let animationCardAngleCurrentCache: number[][] | null = null
let animationCardTypeCache: number[][] | null = null
let prevAnimationTime: number = -1 // ms
function cardFlipAnimationStep() {
    const currTime = Date.now()
    const elapsedTime = currTime - prevAnimationTime // ms

    for (let rowInd = 0; rowInd < (animationCardAngleTargetCache?.length as number); rowInd++) {
        const row = animationCardAngleTargetCache![rowInd]
        for (let colInd = 0; colInd < (row?.length as number); colInd++) {
            // animation param update
            if (animationCardTypeCache![rowInd]![colInd] !== quizBoard!.getMatrix()[rowInd]![colInd]) {
                animationCardAngleTargetCache![rowInd]![colInd] = 180 // deg
            } else {
                animationCardAngleTargetCache![rowInd]![colInd] = 0 // deg
            }

            const currAngle = animationCardAngleCurrentCache![rowInd]![colInd] as number
            const targetAngle = animationCardAngleTargetCache![rowInd]![colInd] as number

            const newAngle = currAngle + (targetAngle - currAngle) * Math.min(1.0, 0.1 * (elapsedTime / (1000/60)))

            if (newAngle > 90) {
                animationCardAngleCurrentCache![rowInd]![colInd] = newAngle - 180 // deg
                animationCardTypeCache![rowInd]![colInd] = quizBoard!.getMatrix()[rowInd]![colInd] as number
            } else {
                animationCardAngleCurrentCache![rowInd]![colInd] = newAngle // deg
            }

            // animation render
            const card = document.getElementById(`quiz_card_${rowInd}_${colInd}`) as HTMLDivElement
            card.style.transform = `rotateY(${animationCardAngleCurrentCache![rowInd]![colInd]}deg)`;
            card.className = CARD_CLASS_NAME_DICT[animationCardTypeCache![rowInd]![colInd] as number] as string
        }
    }

    prevAnimationTime = currTime
    requestAnimationFrame(cardFlipAnimationStep)
}


function setAnimationCache() {
    animationCardAngleTargetCache = quizBoard!.getMatrix().map(row => row.map(() => 0))
    animationCardAngleCurrentCache = quizBoard!.getMatrix().map(row => row.map(() => 0))
    animationCardTypeCache = quizBoard!.getMatrix().map(row => [...row])
}


function initRandomQuiz() {
    const quizGenerator = new QuizGenerator()
    quizBoard = quizGenerator.generate()
    answerBoard = quizGenerator.getAnswer()
    setAnimationCache()
}


/** Ratio of the cells that already match the answer board. */
function calcSimilarity() {
    const quizMatrix = quizBoard!.getMatrix()
    const answerMatrix = answerBoard!.getMatrix()

    let sameCount = 0
    for (let rowInd = 0; rowInd < quizBoard!.numRows; rowInd++) {
        for (let colInd = 0; colInd < quizBoard!.numCols; colInd++) {
            if (quizMatrix[rowInd]![colInd] === answerMatrix[rowInd]![colInd]) {
                sameCount++
            }
        }
    }

    return sameCount / (quizBoard!.numRows * quizBoard!.numCols)
}


/** 1 for a perfect match, otherwise half of the similarity. */
function calcScore() {
    const similarity = calcSimilarity()
    const score = similarity === 1 ? 10 : 0.1 * similarity
    return roundToTwoDecimals(score)
}


function roundToTwoDecimals(value: number) {
    return Math.round(value * 100) / 100
}


function clearFadeTimers() {
    for (const timerId of fadeTimerIds) {
        window.clearTimeout(timerId)
    }
    fadeTimerIds = []
}


/** Refresh the similarity / expected score shown for the current level. */
function refreshPreview() {
    similarity.value = calcSimilarity()
    expectedScore.value = calcScore()
}


function startNextQuiz() {
    initRandomQuiz()
    setQuizCardArea()
    setAnswerCardArea()
    fitQuizCardArea()
    refreshPreview()
    automationBridge.notifyLevelStarted()
}


/** Result of a submission, also returned to automation clients. */
type SubmitResult = {
    similarity: number
    expectedScore: number
    totalScore: number
    perfect: boolean
}


/**
 * Score the current board and roll the next one in.
 * Returns null when a submission is already playing.
 */
function submitAnswer(): SubmitResult | null {
    // ignore taps while the fade transition is playing, so the score cannot be farmed
    if (isSubmitting.value) {
        return null
    }

    const submittedSimilarity = roundToTwoDecimals(calcSimilarity())
    const submittedScore = calcScore()
    const submittedTotalScore = roundToTwoDecimals(totalScore.value + submittedScore)

    isSubmitting.value = true
    // starts the 2 s submit cooldown shared with the automation protocol
    automationBridge.markSubmitted()

    totalScore.value = submittedTotalScore
    fadePhase.value = 'out'

    clearFadeTimers()
    fadeTimerIds.push(window.setTimeout(() => {
        // the boards are swapped while they are fully transparent
        startNextQuiz()
        fadePhase.value = 'in'

        fadeTimerIds.push(window.setTimeout(() => {
            fadePhase.value = 'idle'
            isSubmitting.value = false
            fadeTimerIds = []
        }, FADE_DURATION))
    }, FADE_DURATION))

    return {
        similarity: submittedSimilarity,
        expectedScore: submittedScore,
        totalScore: submittedTotalScore,
        perfect: submittedSimilarity === 1,
    }
}


/** Copy of a board in the shape shared by every automation client. */
function boardSnapshot(board: BakingBoard): AutomationBoardSnapshot {
    return {
        numRows: board.numRows,
        numCols: board.numCols,
        numTypes: board.numTypes,
        matrix: board.getMatrix().map(row => [...row]),
    }
}


function parseIndex(value: unknown, name: string, max: number): number {
    const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof num !== 'number' || !Number.isInteger(num) || num < 0 || num >= max) {
        throw new Error(`${name} must be an integer in [0, ${max - 1}], got ${JSON.stringify(value)}`)
    }
    return num
}


/**
 * The baking game's adapter for the shared automation protocol.
 * Everything protocol related (connection, retries, action buffer, rate
 * limits) lives in `GameAutomationBridge`, this object only touches the board.
 */
const automationBridge = new GameAutomationBridge<BakingTapAction, Record<string, unknown>>({
    gameId: 'baking',

    getState() {
        return {
            started: quizBoard !== null && answerBoard !== null,
            board: quizBoard ? boardSnapshot(quizBoard) : null,
            target: answerBoard ? boardSnapshot(answerBoard) : null,
            metrics: {
                similarity: roundToTwoDecimals(calcSimilarity()),
                expectedScore: calcScore(),
                totalScore: totalScore.value,
                isPerfect: isPerfectMatch.value,
            },
            busy: isSubmitting.value,
        }
    },

    describeLevel() {
        return {
            numRows: quizBoard?.numRows ?? 0,
            numCols: quizBoard?.numCols ?? 0,
            numTypes: quizBoard?.numTypes ?? 0,
            actionKind: 'tap',
            actionFields: { rowInd: 'int', colInd: 'int' },
        }
    },

    normalizeAction(raw) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            throw new Error('a tap action must be an object like {"rowInd": 0, "colInd": 0}')
        }
        const { rowInd, colInd } = raw as Record<string, unknown>
        if (!quizBoard) {
            throw new Error('the board is not ready yet')
        }
        return {
            rowInd: parseIndex(rowInd, 'rowInd', quizBoard.numRows),
            colInd: parseIndex(colInd, 'colInd', quizBoard.numCols),
        }
    },

    applyAction(action) {
        quizBoard!.tapAt(action.rowInd, action.colInd)
        refreshPreview()
    },

    canApplyAction() {
        return !isSubmitting.value
    },

    canSubmit() {
        return !isSubmitting.value
    },

    submit() {
        const result = submitAnswer()
        if (!result) {
            throw new Error('a submission is already in progress')
        }
        return result
    },
})


onMounted(() => {
    startNextQuiz()
    cardFlipAnimationStep()
    window.addEventListener('resize', fitQuizCardArea)
    // NOTE: no connect() here on purpose. The browser only asks for permission
    // to reach the local network while the page has user activation, so the
    // dial has to happen inside the click on the panel's 连接 button.
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', fitQuizCardArea)
    setPhoneLayoutFlag('baking', false)
    clearFadeTimers()
    automationBridge.dispose()
})



</script>


<template>
    <div
        ref="answerArea"
        class="answer-area"
        :class="{ 'is-fading-out': fadePhase === 'out', 'is-fading-in': fadePhase === 'in' }"
    >
        <div ref="answerLabel" class="answer-label">目标配方</div>
        <div ref="answerCardArea" class="answer-card-area"></div>
    </div>
    <div class="score-area">
        <div class="score-label">总得分</div>
        <div class="score-value">{{ totalScore.toFixed(2) }}</div>
    </div>
    <div
        ref="quizCardArea"
        class="quiz-card-area"
        :class="{ 'is-fading-out': fadePhase === 'out', 'is-fading-in': fadePhase === 'in' }"
    ></div>
    <!--
        Celebration played together with the submit fade: a giant "energy bread"
        drops in from above the screen, lands in the middle and then pops away.
        It is kept before the automation panel on purpose: both are fixed
        elements without a z-index, so the panel stays readable on top of it.
    -->
    <div
        class="raspberry-cake"
        :class="{ 'is-falling': fadePhase !== 'idle' }"
        aria-hidden="true"
    ></div>
    <div ref="submitArea" class="submit-area">
        <div class="preview" :class="{ 'is-perfect': isPerfectMatch }">
            <div class="preview-row">
                <span class="preview-label">相似度</span>
                <span class="preview-value">{{ similarityText }}</span>
            </div>
            <div class="preview-row">
                <span class="preview-label">预期得分</span>
                <span class="preview-value">{{ expectedScoreText }}</span>
            </div>
        </div>
        <button class="submit-button" :disabled="isSubmitting" @click="submitAnswer">提交</button>
    </div>
    <div class="miss-raspberry-cute"></div>
    <BackHomeButton />
    <audio :src="BGM_SRC" autoplay loop></audio>
    <!-- a phone plays with a finger: nothing to connect a player program to -->
    <GameAutomationPanel v-if="!isPhone" :bridge="automationBridge" />
</template>


<style>
html {
    background-color: #b27f00;
}

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

/*
 * The energy bread that drops in with every submission.
 * Its animation runs for 2 * FADE_DURATION ms, so it spans the fade-out of the
 * old board (which is swapped while invisible) and the fade-in of the new one.
 */
@keyframes raspberry-cake-drop {
    0% {
        opacity: 0;
        transform: translate(-50%, -50%) translateY(-135vh) rotate(-14deg) scale(0.85);
    }
    12% {
        opacity: 1;
    }
    46% {
        transform: translate(-50%, -50%) translateY(0) rotate(0deg) scale(1);
        animation-timing-function: ease-out;
    }
    54% {
        transform: translate(-50%, -50%) translateY(-3vh) rotate(1.5deg) scale(1.02);
        animation-timing-function: ease-in;
    }
    62% {
        transform: translate(-50%, -50%) translateY(0) rotate(0deg) scale(1);
        animation-timing-function: ease-in-out;
    }
    76% {
        opacity: 1;
        transform: translate(-50%, -50%) translateY(0) rotate(0deg) scale(1);
        animation-timing-function: ease-out;
    }
    100% {
        opacity: 0;
        transform: translate(-50%, -50%) translateY(0) rotate(0deg) scale(1.5);
    }
}

.raspberry-cake {
    position: fixed;
    left: 50%;
    top: 50%;
    width: min(78vw, 78vh);
    aspect-ratio: 1;
    background-image: url('/images/it/energy_bread.svg');
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
    /* charged look: a warm glow around the bread's silhouette */
    filter: drop-shadow(0 0 3vmin rgba(255, 214, 82, 0.85)) drop-shadow(0 0 0.8vmin rgba(255, 247, 214, 0.9));
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -50%);
    will-change: transform, opacity;
}

.raspberry-cake.is-falling {
    /* 2 * FADE_DURATION, keep in sync with the script */
    /* the default ease-in makes the bread accelerate on its way down */
    animation: raspberry-cake-drop 2000ms ease-in forwards;
}

.answer-area {
    position: fixed;
    left: min(5vw, 5vh);
    /* below the back-to-home button, which lives in this corner */
    top: calc(min(5vw, 5vh) + var(--back-home-room));
    width: min(14vw, 22vh);
    display: flex;
    flex-direction: column;
    gap: min(1.4vh, 14px);
}

.answer-label {
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: min(2.2vw, 3.4vh);
    line-height: 1.1;
    color: #fff6e0;
    text-shadow: 0 1px 2px rgba(90, 50, 0, 0.6);
}

.answer-card-area {
    width: 100%;
}

.score-area {
    position: fixed;
    right: min(5vw, 5vh);
    top: min(5vw, 5vh);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: min(1.4vh, 14px);
}

.score-label {
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: min(2.2vw, 3.4vh);
    line-height: 1.1;
    color: #fff6e0;
    text-shadow: 0 1px 2px rgba(90, 50, 0, 0.6);
}

.score-value {
    font-family: 'DymonShouXieTi', sans-serif;
    font-size: min(3.2vw, 5vh);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(90, 50, 0, 0.6);
}

.submit-area {
    position: fixed;
    right: min(5vw, 5vh);
    bottom: min(5vw, 5vh);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: min(2vh, 20px);
}

.preview {
    display: flex;
    flex-direction: column;
    gap: min(0.8vh, 8px);
    font-family: 'DymonShouXieTi', sans-serif;
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

.preview.is-perfect {
    color: #9dffb6;
    text-shadow: 0 0 6px rgba(70, 255, 128, 0.95), 0 0 16px rgba(33, 201, 79, 0.75);
    transform-origin: 100% 50%;
    animation: perfect-pop 600ms ease-out 1;
}

.preview.is-perfect .preview-value {
    color: #ddffe5;
}

@keyframes perfect-pop {
    0% { transform: scale(1); }
    35% { transform: scale(1.16); }
    65% { transform: scale(0.97); }
    100% { transform: scale(1); }
}

@keyframes swing {
    0% { transform: rotate(-5deg) }
    50% { transform: rotate(10deg); }
    100% { transform: rotate(-5deg) }
}

.submit-button {
    font-family: 'DymonShouXieTi', sans-serif;
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

.quiz-card-area {
    position: fixed;
    width: min(30vw, 80vh);
    /* backstop for the "more than 25vw on each side" rule */
    max-width: 50vw;
    left: 50vw;
    top: 50vh;
    transform: translate(-50%, -50%);
}

.card {
    background-color: white;
    background-size: contain;
    border-radius: 10px;
}

.card.water-bucket {
    background-image: url('/images/it/water_bucket.png');
}

.card.flour {
    background-image: url('/images/it/flour.png');
}

.miss-raspberry-cute {
    position: fixed;
    left: 10px;
    bottom: 10px;
    width: 20vw;
    aspect-ratio: 1;
    background-image: url('/images/ui/miss-raspberry-cute-1.png');
    background-size: contain;
    animation: swing ease-in-out 1s infinite;
}

/* ---------------------------------------------------------------------------
 * the phone layout
 *
 * A portrait screen gets one column: the target recipe on top of it, the play
 * board under the recipe, and the score, the preview and the submit button in
 * the corners around them. The script sizes the two boards; these rules place
 * them and keep the browser's own gestures out of the game.
 * ------------------------------------------------------------------------- */

.is-phone-baking .answer-area {
    left: 50%;
    /* under the back-to-home button, which keeps the top left corner */
    top: var(--back-home-room, 60px);
    width: auto;
    align-items: center;
    transform: translateX(-50%);
}

.is-phone-baking .answer-label {
    font-size: clamp(12px, 3.6vw, 18px);
    text-align: center;
}

.is-phone-baking .quiz-card-area {
    /* the script puts the board in the room which is left under the recipe */
    left: 50%;
    max-width: none;
    transform: translate(-50%, -50%);
    touch-action: none;
}

.is-phone-baking .card {
    /* a tap turns a card over, nothing else */
    touch-action: manipulation;
}

.is-phone-baking .score-area {
    right: min(4vw, 4vh);
    top: min(2.4vw, 2.4vh);
    flex-direction: row;
    align-items: baseline;
    gap: 0.5em;
}

.is-phone-baking .score-label {
    font-size: clamp(11px, 3.4vw, 16px);
}

.is-phone-baking .score-value {
    font-size: clamp(14px, 4.4vw, 22px);
}

.is-phone-baking .submit-area {
    right: min(4vw, 4vh);
    bottom: min(3vw, 3vh);
}

.is-phone-baking .preview {
    font-size: clamp(11px, 3.6vw, 17px);
}

.is-phone-baking .submit-button {
    font-size: clamp(15px, 4.6vw, 22px);
    touch-action: manipulation;
}

.is-phone-baking .miss-raspberry-cute {
    /* every corner is taken on a phone, and the mascot would sit on the board */
    display: none;
}

</style>
