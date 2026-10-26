/**
 * The decision kind of the `openai` engine type: the UAG's decision questions,
 * answered by OpenAI's Decisions API (`POST /v1/decisions`).
 *
 *   UAG UAG question   Decisions API question     answer
 *   noul (yes/no)      predicate                  probability
 *   choice             choice                     choice, probabilities, confidence
 *   score              score (levels, lowest first) score, probabilities, confidence
 *
 * Question ids are mapped to generated names and back, so the API's naming
 * rules never matter. A question the API declines is left unanswered, which
 * the UAG treats as an undecided field.
 */
const { EngineError, ENGINE_API_VERSION } = require('@formio/uag-sdk');

/** The most questions the Decisions API accepts in one request. */
const MAX_QUESTIONS = 400;

/** A yes/no question as a predicate, with its true and false criteria in the instructions. */
function predicate(question) {
    const criteria = question.criteria || {};
    const notes = [
        criteria.true && `It holds when: ${criteria.true}`,
        criteria.false && `It does not hold when: ${criteria.false}`,
    ].filter(Boolean);
    return { type: 'predicate', instructions: [question.instructions, ...notes].join('\n') };
}

function toApiQuestion(question, name) {
    switch (question.type) {
        case 'noul':
            return { ...predicate(question), name };
        case 'choice':
            return {
                type: 'choice',
                name,
                instructions: question.instructions,
                choices: Object.entries(question.options).map(([label, description]) => ({ value: label, ...(description && { description }) })),
            };
        case 'score':
            return { type: 'score', name, instructions: question.instructions, levels: question.levels.map((level) => ({ label: level })) };
        default:
            throw new EngineError(`Unsupported question type "${question.type}".`);
    }
}

/** One API answer in the UAG's shape, or undefined when it does not fit the question asked. */
function fromApiAnswer(answer, question) {
    if (!answer || answer.type === 'refusal') return undefined;
    if (question.type === 'noul' && answer.type === 'predicate') {
        return { type: 'noul', probability: answer.probability };
    }
    if (question.type === 'choice' && answer.type === 'choice') {
        const labels = Object.keys(question.options);
        const choice = String(answer.choice);
        if (!labels.includes(choice)) return undefined;
        const probabilities = {};
        for (const entry of answer.probabilities || []) {
            if (labels.includes(String(entry.value))) probabilities[String(entry.value)] = entry.probability;
        }
        return { type: 'choice', choice, probabilities, confidence: answer.confidence };
    }
    if (question.type === 'score' && answer.type === 'score') {
        const probabilities = {};
        for (const entry of answer.probabilities || []) {
            if (Number.isInteger(entry.value) && entry.value >= 0 && entry.value < question.levels.length) {
                probabilities[String(entry.value)] = entry.probability;
            }
        }
        return { type: 'score', score: answer.score, probabilities, confidence: answer.confidence };
    }
    return undefined;
}

/**
 * A decision engine over the Decisions API. `maxOptions` bounds the options
 * the planner sends one choice question; larger closed sets go to an agent.
 */
function decisionEngine({ name, model, client, maxOptions }) {
    async function decideBatch(input, batch, signal) {
        signal?.throwIfAborted();
        const response = await client.decisions.create({
            model,
            input,
            questions: batch.map(({ question, name: apiName }) => toApiQuestion(question, apiName)),
        }, { signal });
        if (!response || !Array.isArray(response.answers)) {
            throw new EngineError('The Decisions API returned no answers.');
        }
        return response;
    }

    return {
        name,
        kind: 'decision',
        apiVersion: ENGINE_API_VERSION,
        model,
        maxOptions,

        async decide({ state, questions, signal }) {
            signal?.throwIfAborted();
            const entries = Object.entries(questions).map(([id, question], index) => ({ id, question, name: `q${index}` }));
            const byName = new Map(entries.map((entry) => [entry.name, entry]));
            const input = JSON.stringify(state);
            const batches = [];
            for (let start = 0; start < entries.length; start += MAX_QUESTIONS) {
                batches.push(entries.slice(start, start + MAX_QUESTIONS));
            }
            const responses = await Promise.all(batches.map((batch) => decideBatch(input, batch, signal)));
            const answers = {};
            const usage = { inputTokens: 0, outputTokens: 0 };
            let reported = false;
            for (const response of responses) {
                for (const answer of response.answers) {
                    const entry = byName.get(answer && answer.name);
                    // Only the questions asked: anything else is dropped here.
                    const mapped = entry && fromApiAnswer(answer, entry.question);
                    if (mapped) answers[entry.id] = mapped;
                }
                if (response.usage) {
                    reported = true;
                    usage.inputTokens += response.usage.input_tokens || 0;
                    usage.outputTokens += response.usage.output_tokens || 0;
                }
            }
            return {
                model: (responses[0] && responses[0].model) || model,
                answers,
                ...(reported && { usage }),
            };
        },
    };
}

module.exports = { MAX_QUESTIONS, decisionEngine, toApiQuestion, fromApiAnswer };
