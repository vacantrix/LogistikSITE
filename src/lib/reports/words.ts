/** Сумма прописью для бухгалтерских документов: «Сто двадцать тысяч шестьсот рублей 00 копеек» */

const ONES = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']

/** разряды: тысяча — женского рода («одна тысяча», «две тысячи») */
const SCALES: { forms: [string, string, string]; feminine: boolean }[] = [
  { forms: ['', '', ''], feminine: false },
  { forms: ['тысяча', 'тысячи', 'тысяч'], feminine: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], feminine: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], feminine: false },
]

/** форма слова для числа: 1 рубль, 2 рубля, 5 рублей, 11 рублей */
export function plural(n: number, forms: [string, string, string]): string {
  const n100 = n % 100
  const n10 = n % 10
  if (n100 >= 11 && n100 <= 14) return forms[2]
  if (n10 === 1) return forms[0]
  if (n10 >= 2 && n10 <= 4) return forms[1]
  return forms[2]
}

function triad(n: number, feminine: boolean): string[] {
  const words: string[] = []
  const h = Math.floor(n / 100)
  const t = Math.floor((n % 100) / 10)
  const o = n % 10
  if (h) words.push(HUNDREDS[h])
  if (t === 1) words.push(TEENS[o])
  else {
    if (t) words.push(TENS[t])
    if (o) words.push((feminine ? ONES_F : ONES)[o])
  }
  return words
}

/** целое число прописью (мужской род), 0 — «ноль» */
export function numberInWords(n: number): string {
  let rest = Math.floor(Math.abs(n))
  if (rest === 0) return 'ноль'
  const parts: string[] = []
  for (let i = 0; rest > 0 && i < SCALES.length; i++) {
    const chunk = rest % 1000
    if (chunk) {
      const scale = SCALES[i]
      const words = triad(chunk, scale.feminine)
      if (i > 0) words.push(plural(chunk, scale.forms))
      parts.unshift(words.join(' '))
    }
    rest = Math.floor(rest / 1000)
  }
  return parts.join(' ')
}

/** «Один миллион четыреста шестьдесят пять тысяч пятьсот рублей 00 копеек» */
export function rublesInWords(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100)
  const rub = Math.floor(cents / 100)
  const kop = cents % 100
  const text = `${numberInWords(rub)} ${plural(rub, ['рубль', 'рубля', 'рублей'])} ${String(kop).padStart(2, '0')} ${plural(kop, ['копейка', 'копейки', 'копеек'])}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}
