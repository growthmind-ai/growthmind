import { BrowserDriver } from "../driver-client";
import type { PersonaBrain, PersonaDecision, StepMemory } from "../persona/brain";
import type { ConsoleErrorRecord, DriverAction } from "../protocol";
import type { Persona, Scenario } from "../scenario/types";

export type SessionOutcome = "completed" | "gave_up" | "step_cap" | "driver_error";

export interface StepRecord {
  readonly step: number;
  readonly url: string;
  readonly screenshotPath: string;
  readonly decision: PersonaDecision;
  readonly acted: { readonly ok: boolean; readonly error: string | null } | null;
}

export interface PersonaSessionResult {
  readonly sessionId: string;
  readonly personaId: string;
  readonly personaLabel: string;
  readonly outcome: SessionOutcome;
  readonly outcomeReason: string | null;
  readonly steps: readonly StepRecord[];
  readonly sessionPath: string | null;
  readonly finalUrl: string | null;
  readonly eventCount: number;
  readonly consoleErrors: readonly ConsoleErrorRecord[];
  readonly recordError: string | null;
}

const DRIVER_ACTION_OF: Readonly<Record<string, DriverAction>> = {
  click: "click",
  type: "type",
  press_enter: "press_enter",
  scroll: "scroll",
  back: "back",
  wait: "wait",
};

function outcomeOf(action: PersonaDecision["action"]): SessionOutcome | null {
  if (action === "give_up") return "gave_up";
  if (action === "done") return "completed";
  return null;
}

export interface RunPersonaInput {
  readonly scenario: Scenario;
  readonly persona: Persona;
  readonly facts: Readonly<Record<string, string>>;
  readonly brain: PersonaBrain;
  readonly outDir: string;
  readonly driverPath: string;
  readonly sessionId: string;
  readonly onStep?: (record: StepRecord) => void;
}

export async function runPersonaSession(input: RunPersonaInput): Promise<PersonaSessionResult> {
  const driver = new BrowserDriver({
    url: input.scenario.startUrl,
    outDir: input.outDir,
    width: input.scenario.viewport.width,
    height: input.scenario.viewport.height,
    driverPath: input.driverPath,
  });

  const steps: StepRecord[] = [];
  const history: StepMemory[] = [];
  let outcome: SessionOutcome = "step_cap";
  let outcomeReason: string | null = null;

  const base = {
    sessionId: input.sessionId,
    personaId: input.persona.id,
    personaLabel: input.persona.label,
  };

  try {
    let message = await driver.next();

    for (;;) {
      if (message.type === "error") {
        return {
          ...base,
          outcome: "driver_error",
          outcomeReason: message.message,
          steps,
          sessionPath: null,
          finalUrl: null,
          eventCount: 0,
          consoleErrors: [],
          recordError: null,
        };
      }

      if (message.type !== "observation") {
        message = await driver.next();
        continue;
      }

      const observation = message;

      if (steps.length >= input.persona.maxSteps) {
        outcome = "step_cap";
        outcomeReason = "ran out of attempts before reaching an outcome";
        break;
      }

      const decision = await input.brain.decide({
        observation,
        history,
        facts: input.facts,
      });

      const terminal = outcomeOf(decision.action);
      if (terminal !== null) {
        const record: StepRecord = {
          step: observation.step,
          url: observation.url,
          screenshotPath: observation.screenshotPath,
          decision,
          acted: null,
        };
        steps.push(record);
        input.onStep?.(record);
        outcome = terminal;
        outcomeReason = decision.reason ?? decision.thinking;
        break;
      }

      const driverAction = DRIVER_ACTION_OF[decision.action];
      if (driverAction === undefined) {
        outcome = "driver_error";
        outcomeReason = `persona asked for an unknown action ${decision.action}`;
        break;
      }

      driver.send({
        type: "act",
        action: driverAction,
        elementIndex: decision.elementIndex,
        text: decision.text,
      });

      const acted = await driver.next();
      if (acted.type !== "acted") {
        outcome = "driver_error";
        outcomeReason = acted.type === "error" ? acted.message : `unexpected ${acted.type}`;
        break;
      }

      const record: StepRecord = {
        step: observation.step,
        url: observation.url,
        screenshotPath: observation.screenshotPath,
        decision,
        acted: { ok: acted.ok, error: acted.error },
      };
      steps.push(record);
      input.onStep?.(record);

      history.push({
        step: observation.step,
        thinking: decision.thinking,
        action: `${decision.action}${decision.elementIndex === null ? "" : ` [${String(decision.elementIndex)}]`}`,
        outcome: acted.ok ? "that worked" : `that did not work: ${acted.error ?? "unknown"}`,
      });

      message = await driver.next();
    }

    driver.send({ type: "finish" });

    let final = await driver.next();
    while (final.type !== "final" && final.type !== "error") {
      final = await driver.next();
    }

    if (final.type === "error") {
      return {
        ...base,
        outcome: "driver_error",
        outcomeReason: final.message,
        steps,
        sessionPath: null,
        finalUrl: null,
        eventCount: 0,
        consoleErrors: [],
        recordError: null,
      };
    }

    return {
      ...base,
      outcome,
      outcomeReason,
      steps,
      sessionPath: final.sessionPath,
      finalUrl: final.finalUrl,
      eventCount: final.eventCount,
      consoleErrors: final.consoleErrors,
      recordError: final.recordError,
    };
  } finally {
    await driver.close();
  }
}
