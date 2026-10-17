export const has = (out, ...parts) => parts.every((p) => out.includes(p));
export const INPUTS = [
  {
    name: 'past tense',
    text: 'yesterday i has went to the meeting but nobody were there, can you tell me why? also the report dont have the numbers we discussed',
    pass: (o) =>
      has(o.toLowerCase(), 'i went', 'nobody was') &&
      /doesn['’]t|does not|didn['’]t|did not/i.test(o),
  },
  {
    name: 'question',
    text: 'can you explain me what is the different between let and const in javascript?',
    pass: (o) =>
      /difference/i.test(o) && has(o, 'let', 'const') && o.length < 140 && o.trim().endsWith('?'),
  },
  {
    name: 'tokens',
    text: 'hey @sara_k check this https://github.com/ashahinL/localpolish/pull/3. i think the `parseLine` function have a bug 🐛 #bugfix',
    pass: (o) =>
      has(
        o,
        '@sara_k',
        'https://github.com/ashahinL/localpolish/pull/3',
        '`parseLine`',
        '🐛',
        '#bugfix',
      ) && /has a bug/i.test(o),
  },
  {
    name: 'mixed arabic',
    text: 'ana mesh fahem leh el meeting et2agel, بس انا هكون free بكرة after 3pm if that work for you',
    pass: (o) => /fahem/i.test(o) && has(o, 'بكرة') && /works for you/i.test(o),
  },
  {
    name: 'email',
    text: 'hi john,\n\ni wanted to let you know that the report are ready. i send it to you tomorow morning. please let me know if their is any problem.\n\nthanks,\nahmed',
    pass: (o) =>
      has(o, 'Hi John', 'report is', 'tomorrow', 'Ahmed') &&
      /there (is|are) any/.test(o) &&
      /I will send|I['’]ll send|I['’]m sending|I will be sending|I am sending/.test(o),
  },
];
