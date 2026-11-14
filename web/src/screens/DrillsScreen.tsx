import { useMemo } from 'react';
import { useToday } from '../hooks/useToday';
import { CheckSquare, Gamepad2, Gauge, Sigma } from 'lucide-react';
import { CardGrid, Section, TabShell } from '../components/shell/TabShell';
import { ActionCard } from '../components/dashboard/Cards';
import { navigate } from '../lib/router';
import { useSettings } from '../lib/settings';
import { useTf } from '../store/tf';
import { isDue, localDay, useGym } from '../formulas/storage';
import { useGameProgress } from '../games/progress';
import { dueItemIds } from '../games/srs';

const due = (n: number, one: string, many: string, otherwise: string) => (n > 0 ? `${n.toLocaleString()} ${n === 1 ? one : many}` : otherwise);

/**
 * Drills: the ways to work the notes other than multiple-choice questions. Recall first (statements and formulas),
 * then judgement and the notes games. Each card says what is waiting there today.
 */
export function DrillsScreen() {
  const tfCount = useTf((s) => s.cards.length);
  const tfStates = useTf((s) => s.states);
  const tfById = useTf((s) => s.byId);
  const tfDeckReady = useTf((s) => s.deckStatus === 'ready');
  const gymStates = useGym((s) => s.states);
  const gameItems = useGameProgress((s) => s.items);
  const exam = useSettings((s) => s.examDate);
  const day = useToday();

  const gymDue = useMemo(() => {
    const d = localDay();
    let formula = 0;
    let scenario = 0;
    for (const s of Object.values(gymStates)) {
      if (!isDue(s, d)) continue;
      if (s.kind === 'formula') formula++;
      else scenario++;
    }
    return { formula, scenario };
  }, [gymStates, day, exam]);
  // True/False has no schedule: a card counts until it is answered correctly again.
  const tfMissed = useMemo(
    () => Object.values(tfStates).filter((s) => s.lastResult === 'wrong' && (!tfDeckReady || tfById[s.cardId])).length,
    [tfStates, tfById, tfDeckReady],
  );
  const gamesDue = useMemo(() => dueItemIds(gameItems, localDay()).length, [gameItems, day, exam]);

  return (
    <TabShell title="Drills" lead="Short rounds on the notes, beyond multiple choice">
      <Section title="Recall">
        <CardGrid>
          <ActionCard
            icon={<CheckSquare className="h-5 w-5" aria-hidden="true" />}
            title="True / False"
            detail={due(
              tfMissed,
              'missed statement to retry',
              'missed statements to retry',
              tfCount > 0 ? `${tfCount.toLocaleString()} statements to judge` : 'Judge statements from your question bank',
            )}
            onClick={() => navigate('/truefalse')}
          />
          <ActionCard
            icon={<Sigma className="h-5 w-5" aria-hidden="true" />}
            title="Formula Gym"
            detail={due(gymDue.formula, 'formula due for review', 'formulas due for review', 'Recall, rebuild and apply every formula in the notes')}
            onClick={() => navigate('/formulas')}
          />
        </CardGrid>
      </Section>

      <Section title="Judgement and games">
        <CardGrid>
          <ActionCard
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            title="Sense Check"
            detail={due(gymDue.scenario, 'scenario due for review', 'scenarios due for review', '3-minute rounds: size and sign an answer before computing it')}
            onClick={() => navigate('/sense')}
          />
          <ActionCard
            icon={<Gamepad2 className="h-5 w-5" aria-hidden="true" />}
            title="Notes Games"
            detail={due(gamesDue, 'item due for review', 'items due for review', 'Play the notes: traps, tables, sequences, curves, trees and more')}
            onClick={() => navigate('/games')}
          />
        </CardGrid>
      </Section>
    </TabShell>
  );
}
