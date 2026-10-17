| Setup                                                                            | Score | Avg   | Median | p90    | Max    | First text (median) | Input tok | Output tok | Misses                                    |
| -------------------------------------------------------------------------------- | ----- | ----- | ------ | ------ | ------ | ------------------- | --------- | ---------- | ----------------------------------------- |
| Haiku 5.5 low                                                                    | 14/20 | 5.1 s | 5.1 s  | 7.9 s  | 8.6 s  | 1.6 s               | 887       | 102        | question 3/4, mixed arabic 3/4, email 0/4 |
| GPT-6 Luna none                                                                  | 16/20 | 4.6 s | 4.6 s  | 5.8 s  | 6.1 s  | 3.5 s               | 13041     | 36         | mixed arabic 0/4                          |
| GPT-6.1 Sol low                                                                  | 20/20 | 5.5 s | 5.3 s  | 6.8 s  | 8.5 s  | 4.4 s               | 13733     | 42         | none                                      |
| Grok 4.7 low                                                                     | 20/20 | 8.9 s | 7.7 s  | 18.3 s | 20.3 s | 6.6 s               | 10782     | 457        | none                                      |
| Grok 4.6 low                                                                     | 18/20 | 7.2 s | 6.7 s  | 13.8 s | 16.9 s | 5.2 s               | 9746      | 247        | email 2/4                                 |
| cost reported by CLI, Haiku 5.5 low: avg $0.00023 per request                    |
| cost reported by CLI, Grok 4.7 low: avg $0.00768 per request                     |
| cost reported by CLI, Grok 4.6 low: avg $0.00703 per request                     |
| codex tokens, GPT-6 Luna none: input 13041 (cached 9856), output 36, reasoning 0 |
| codex tokens, GPT-6.1 Sol low: input 13733 (cached 9088), output 42, reasoning 7 |
