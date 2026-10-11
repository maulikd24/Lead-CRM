# Credits and licences

## Cult UI (MIT)

Several interface ideas in this app follow [Cult UI](https://www.cult-ui.com) (MIT licence, (c) its authors). **No Cult UI source code was copied and no Cult UI package is a dependency.** Each component below was written from scratch in this codebase, with our own tokens, accessibility behaviour and tests, so the MIT notice is not required to be carried in any file. It is credited here and in each component's comment out of courtesy.

| Idea from Cult UI | Reimplemented as |
| --- | --- |
| Kanban board | `src/components/leads/pipeline-board.tsx` (own pointer and keyboard drag, announcements, optimistic move with Undo) |
| Rolling number | `src/components/wow/rolling-number.tsx` (pure CSS odometer, no dependency) |
| Agent / suggestion stack | `src/components/suggest/suggestion-stack.tsx` |
| Prompt composer | `src/app/(dashboard)/inbox/suggested-reply-view.tsx` (draft only, nothing is sent) |
| Copy button | `src/components/ui/copy-button.tsx` |
| Halo dropzone | `src/components/ui/file-dropzone.tsx` |

If any Cult UI source is ever copied into the repository, keep its MIT copyright and permission notice with that file and add it to this table.

## Motion

Animated components use the `motion` package (MIT), already a dependency.
