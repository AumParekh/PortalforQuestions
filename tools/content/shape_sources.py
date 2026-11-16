#!/usr/bin/env python3
"""Gathers, per tier topic, everything the sources say about it into one text file for the topic's author.

    shape_sources.py            writes data/build-inputs/shapes/topics/<ID>.source.txt for every topic in the syllabus

A topic's file holds, in order: the workbook section (specifics reported, shapes, revision notes, formulas, traps;
its questions are left out), the workbook's index of shapes for the topic, the Master LO Map rows of the topic's
readings (bands, Vardeez's pointers, the shapes pinned to each learning objective), the Cross-Source Priority Map
entries the section cites, and the Return on Learning Objective ranking of those entries. Needs pdftotext.
"""
import difflib
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INPUTS = os.path.join(ROOT, 'data', 'build-inputs')
OUT = os.path.join(INPUTS, 'shapes', 'topics')
VOLUMES = ('FRM_Workbook_Vol1_TierA.pdf', 'FRM_Workbook_Vol2_TiersB-D.pdf')
LIGATURES = {'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl'}
READING = re.compile(r'^\s{1,6}((?:MR|CR|ORR|LTR|IM|CI)-\d+)\s+[A-Z“"(\d]')


def text_of(path: str) -> list:
    out = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True, check=True).stdout
    for k, v in LIGATURES.items():
        out = out.replace(k, v)
    return [re.sub(r' {2,}', '  ', line.rstrip()) for line in out.split('\n')]


def workbook_sections(lines: list) -> dict:
    """Section id -> its lines up to its first question (or to the next section, for notes-only sections)."""
    starts = [i for i, l in enumerate(lines) if re.match(r'^[A-D]\d+ \S', l.strip()) and any(x.strip().startswith('Readings:') for x in lines[i + 1:i + 4])]
    out = {}
    for a, b in zip(starts, starts[1:] + [len(lines)]):
        sid = lines[a].split()[0]
        end = next((i for i in range(a, b) if re.match(rf'^\s*Question {sid}\.1\b', lines[i])), b)
        body = [l for l in lines[a:end] if l.strip() and not l.startswith('FRM Part II · Volume') and not re.fullmatch(r'\s*\d+\s*', l)]
        out[sid] = body
    return out


def shape_index(lines: list) -> dict:
    """Section id -> the rows of the "Specifics coverage index" (shape number, wording, the questions that drill it)."""
    starts = [i for i, l in enumerate(lines) if l.strip() == 'Specifics coverage index']
    a = starts[-1]
    b = next(i for i in range(a, len(lines)) if lines[i].strip().startswith('Syllabus map (2026 LOs)'))
    out, cur = {}, None
    for l in lines[a:b]:
        m = re.match(r'^\s*([A-D]\d+)\s+(S\d+)\s+(.*)$', l)
        if m:
            cur = m.group(1)
            out.setdefault(cur, []).append(f'{m.group(2)}  {m.group(3).strip()}')
        elif cur and l.strip() and not l.strip().startswith(('ID ', 'FRM Part II')) and not re.fullmatch(r'\s*\d+\s*', l):
            out[cur][-1] += ' ' + l.strip()
    return out


def lo_map_readings(lines: list) -> dict:
    """Reading id -> its block in the Master LO Map's LO-level pages (the last time the reading is headed)."""
    heads = [(i, READING.match(l).group(1)) for i, l in enumerate(lines) if READING.match(l)]
    out = {}
    for (a, rid), (b, _) in zip(heads, heads[1:] + [(len(lines), '')]):
        block = [l for l in lines[a:b] if l.strip() and 'MASTER MAP v3' not in l and not re.fullmatch(r'\s*\d+\s*', l)]
        if any(re.match(r'^\s+P[1-4]\s+[a-z]\s', l) for l in block):
            out[rid] = block
    return out


def map_entries(lines: list) -> dict:
    """Priority Map entry number -> its text."""
    heads = [i for i, l in enumerate(lines) if re.match(r'^\d{2}\s+[A-Z]', l.strip()) and i + 1 < len(lines) and 'SOURCES' in ''.join(lines[i + 1:i + 3])]
    out = {}
    for a, b in zip(heads, heads[1:] + [len(lines)]):
        body = [l for l in lines[a:b] if l.strip() and not l.strip().startswith(('Exam 07 Aug', 'FRM Part II ·', 'SECTION 0', 'APPENDIX'))]
        end = next((k for k, l in enumerate(body) if l.strip().startswith(('Tier ', 'Conflicts and corrections')) and k > 3), len(body))
        out[int(lines[a].strip()[:2])] = body[:end]
    return out


def rankings(lines: list) -> list:
    """(rank, concept title as printed on its first line, action) from the master ranking of Return on LO."""
    a = next(i for i, l in enumerate(lines) if 'Master ranking' in l)
    b = next(i for i in range(a, len(lines)) if lines[i].strip().startswith('Book by book'))
    out = []
    for i in range(a, b):
        m = re.match(r'^\s*(\d{1,2})\s+(\S.*?)\s+(MR|CR|OR|LR|IM|CI)\s+\d+\s+\d+\s+[\d.]+\s+[\d.]+\s*(STRIKE|QUICK|GRIND|DEFER)?', lines[i])
        if m:
            action = m.group(4) or next((x for l in lines[i + 1:i + 3] for x in re.findall(r'STRIKE|QUICK|GRIND|DEFER', l)), '')
            out.append((int(m.group(1)), m.group(2).strip(), {'STRIKE': 'Strike first', 'QUICK': 'Quick win', 'GRIND': 'Grind', 'DEFER': 'Defer'}.get(action, '')))
    return out


def main():
    tiers = json.load(open(os.path.join(INPUTS, 'lo-map', 'tiers.json'), encoding='utf8'))
    sections, index = {}, {}
    for pdf in VOLUMES:
        lines = text_of(os.path.join(INPUTS, 'question-banks', 'pdf', pdf))
        sections.update(workbook_sections(lines))
        index.update(shape_index(lines))
    lo_map = lo_map_readings(text_of(os.path.join(INPUTS, 'lo-map', 'FRM_P2_Master_LO_Map_v3.pdf')))
    entries = map_entries(text_of(os.path.join(INPUTS, 'priority-map', 'FRM_Part_II_Cross_Source_Priority_Map.pdf')))
    ranks = rankings(text_of(os.path.join(INPUTS, 'priority-map', 'FRM_Part_II_Return_on_Learning_Objective.pdf')))
    os.makedirs(OUT, exist_ok=True)
    report = []
    for sec in tiers['sections']:
        sid = sec['id']
        if not sec['los']:
            continue  # not in the 2026 learning objectives (B5, D17): out of syllabus
        body = sections.get(sid, [])
        numbers = sorted({int(n) for n in re.findall(r'#(\d+)', ' '.join(body[:8]))})
        parts = [f'TOPIC {sid}: {sec["title"]} (Tier {sec["tier"]})', '',
                 '=' * 30 + ' 1. WORKBOOK SECTION (specifics reported, shapes, revision notes, formulas, traps)', *body, '',
                 '=' * 30 + ' 2. WORKBOOK INDEX OF SHAPES (shape, wording, the workbook questions that drill it)', *index.get(sid, ['(none listed)']), '',
                 '=' * 30 + ' 3. MASTER LO MAP: the readings this topic covers (band, wording, Vardeez pointers, pinned shapes)']
        for r in sec['readings']:
            parts += lo_map.get(r['reading'], [f"({r['reading']} not found)"]) + ['']
        parts.append('=' * 30 + ' 4. CROSS-SOURCE PRIORITY MAP entries cited by the section')
        for n in numbers:
            parts += entries.get(n, [f'(entry {n} not found)']) + ['']
        if not numbers:
            parts.append('(the section is not in the Priority Map)')
        parts.append('=' * 30 + ' 5. RETURN ON LEARNING OBJECTIVE (rank of 86 and action) for those entries')
        for n in numbers:
            title = entries[n][0].strip()[2:].strip() if n in entries else ''
            best = max(ranks, key=lambda r: difflib.SequenceMatcher(None, r[1].lower(), title.lower()[:len(r[1])]).ratio(), default=None)
            ok = best and difflib.SequenceMatcher(None, best[1].lower(), title.lower()[:len(best[1])]).ratio() > 0.8
            parts.append(f'Map #{n} {title}: ' + (f'rank {best[0]}, {best[2]}' if ok else 'not ranked'))
        with open(os.path.join(OUT, f'{sid}.source.txt'), 'w', encoding='utf8') as f:
            f.write('\n'.join(parts) + '\n')
        report.append((sid, len(body), len(index.get(sid, [])), [r['reading'] for r in sec['readings'] if r['reading'] not in lo_map], numbers))
    for row in report:
        flag = '' if row[1] > 10 and row[2] and not row[3] else '   <<< check'
        print(f'{row[0]:4s} section lines {row[1]:4d}  shapes {row[2]}  map {row[4]}{flag}')
    print(len(report), 'topics')


if __name__ == '__main__':
    main()
