<script setup lang="ts">
// FAQ with PLACEHOLDER content (to be replaced by the real questions). Fully voice-driven:
// "read question 3", "read all questions", or tap a question to open it.
definePageMeta({
  announce: 'FAQ. Say read all questions, or read question and a number.',
})

const FAQS = [
  { q: 'What is Afronet?', a: 'Afronet is an assistant that runs on your phone. You can talk to it or type, and it answers without using the internet.' },
  { q: 'Do I need internet to use it?', a: 'Only once, to download the AI and voice. After that everything works offline.' },
  { q: 'How much data does setup use?', a: 'About 470 megabytes, one time. Use Wi-Fi if you can.' },
  { q: 'Is what I say private?', a: 'Yes. Your voice and questions stay on your phone. Nothing is sent anywhere.' },
  { q: 'How do I talk to Afronet?', a: 'Tap the microphone button and speak. It stops listening by itself when you finish.' },
  { q: 'What can I say?', a: 'Ask any question, or say things like go to chat, go to FAQ, go back, repeat, or stop. Say help to hear more.' },
  { q: 'Why was an answer wrong?', a: 'The AI is small so it can run on a phone. It can make mistakes or have old information, so check important answers.' },
  { q: 'How do I free up space?', a: 'This is a placeholder answer. A settings screen to manage storage will come later.' },
]

const speech = useSpeech()
const open = ref<number | null>(null)

function readQuestion(n: number) {
  const item = FAQS[n - 1]
  if (!item) {
    speech.say(`There are ${FAQS.length} questions. Say a number from 1 to ${FAQS.length}.`)
    return
  }
  open.value = n - 1
  nextTick(() => document.getElementById(`faq-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  speech.say(`Question ${n}. ${item.q} ${item.a}`)
}

function readAll() {
  speech.say(`There are ${FAQS.length} questions. ${FAQS.map((f, i) => `${i + 1}. ${f.q}`).join(' ')} Say read question and a number to hear an answer.`)
}

function toggle(i: number) {
  if (open.value === i) {
    open.value = null
    speech.stop()
  }
  else {
    readQuestion(i + 1)
  }
}

useVoiceCommands([
  { id: 'faq-read', help: 'read question and a number', phrases: ['read question {n}', 'question {n}', 'read {n}', 'open question {n}', 'read {n} question', 'play question {n}', 'answer {n}'], run: ({ n }) => readQuestion(n!) },
  { id: 'faq-list', help: 'read all questions', phrases: ['read questions', 'read all questions', 'list questions', 'what are questions', 'all questions'], run: readAll },
])
</script>

<template>
  <main class="faq">
    <p class="intro">
      Tap a question, or tap the mic and say <em>“read question 2”</em>.
      <span class="placeholder">Placeholder questions</span>
    </p>
    <ol>
      <li v-for="(item, i) in FAQS" :id="`faq-${i + 1}`" :key="item.q" :class="{ open: open === i }">
        <button class="q" :aria-expanded="open === i" @click="toggle(i)">
          <span class="num">{{ i + 1 }}</span>
          <span>{{ item.q }}</span>
        </button>
        <p v-if="open === i" class="a">{{ item.a }}</p>
      </li>
    </ol>
  </main>
</template>

<style scoped>
.faq {
  flex: 1;
  overflow-y: auto;
  /* Room for the floating mic so it never covers the last question. */
  padding: 16px 16px calc(120px + env(safe-area-inset-bottom));
}

.intro {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 0.9rem;
}

.placeholder {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  border: 1px dashed var(--border);
  border-radius: 999px;
  font-size: 0.75rem;
}

ol {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  border-radius: 12px;
  background: var(--surface);
}

li.open {
  outline: 2px solid var(--accent);
}

.q {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 52px;
  padding: 10px 14px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.num {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg);
  color: var(--accent-soft);
  font-weight: 600;
  font-size: 0.9rem;
}

.a {
  margin: 0;
  padding: 0 14px 14px 54px;
  color: var(--muted);
  line-height: 1.5;
}
</style>
