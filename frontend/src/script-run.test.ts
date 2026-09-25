import { describe, expect, test } from "vitest";
import type { ScriptResult } from "./api";
import {
  agentChangedScript, lastLine, outcomeLabel, resultFrom, tailOf, troubleshootPrompt,
} from "./script-run";

const ran = (over: Partial<ScriptResult> = {}): ScriptResult => ({
  script: "scripts/fig.py", run: 1, by: "writer", ok: true, code: 0,
  out: "", err: "", figures: [], saved: [], duration_ms: 1300, ...over,
});

describe("the outcome in four words", () => {
  test("each way a run can end has its own line", () => {
    expect(outcomeLabel(null, false)).toBe("Not run yet");
    expect(outcomeLabel(null, true)).toBe("Running");
    expect(outcomeLabel(ran(), false)).toBe("Ran in 1.3 s");
    expect(outcomeLabel(ran({ duration_ms: 40 }), false)).toBe("Ran in 40 ms");
    expect(outcomeLabel(ran({ duration_ms: 42_000 }), false)).toBe("Ran in 42 s");
    expect(outcomeLabel(ran({ ok: false, code: 1 }), false)).toBe("Exit 1");
    expect(outcomeLabel(ran({ ok: false, code: -1, timeout: true }), false))
      .toBe("Stopped after 120 s");
    expect(outcomeLabel(ran({ ok: false, code: -1, stopped: true }), false)).toBe("Stopped");
    // Q-007: not started, because three scripts were running.
    expect(outcomeLabel(ran({ busy: 3 }), false)).toBe("Not run: 3 are running");
  });
});

describe("what of the output is carried to the agent", () => {
  test("the tail, because a traceback ends with the line that matters", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const tail = tailOf(text, 3, 1000);
    expect(tail).toBe("line 97\nline 98\nline 99");
  });

  test("and no more than the byte cap of it", () => {
    const text = "x".repeat(5000) + "\nend";
    expect(tailOf(text, 40, 100)).toHaveLength(100);
    expect(tailOf(text, 40, 100).endsWith("end")).toBe(true);
  });

  test("the last line is the sentence that says what went wrong", () => {
    expect(lastLine("Traceback\n  File x\nValueError: boom\n\n")).toBe("ValueError: boom");
    expect(lastLine("")).toBe("");
  });

  test("the prompt names the script, the run and the failure, and asks for words", () => {
    const prompt = troubleshootPrompt("scripts/fig.py", ran({
      ok: false, code: 1, err: "Traceback\nValueError: boom",
    }));
    expect(prompt.startsWith("Fix scripts/fig.py. I ran it from the editor and it failed with exit 1:")).toBe(true);
    expect(prompt).toContain("```\nTraceback\nValueError: boom\n```");
    expect(prompt.endsWith("When it runs, say what you changed.")).toBe(true);
    const timed = troubleshootPrompt("scripts/fig.py", ran({ ok: false, code: -1, timeout: true, err: "stopped" }));
    expect(timed).toContain("still running after 120 seconds");
  });
});

describe("when the agent has changed a script that failed here", () => {
  const failed = { path: "scripts/fig.py", running: false, result: ran({ ok: false, code: 1 }) };
  test("only an agent write to that script after a failed run counts", () => {
    expect(agentChangedScript(failed, ["scripts/fig.py"], true)).toBe(true);
    expect(agentChangedScript(failed, ["scripts/fig.py"], false)).toBe(false);
    expect(agentChangedScript(failed, ["main.tex"], true)).toBe(false);
    expect(agentChangedScript({ ...failed, result: ran() }, ["scripts/fig.py"], true)).toBe(false);
    expect(agentChangedScript({ ...failed, running: true }, ["scripts/fig.py"], true)).toBe(false);
    expect(agentChangedScript(null, ["scripts/fig.py"], true)).toBe(false);
  });
});

describe("what the last-run route answered", () => {
  test("a finished run is a result, without the running flag", () => {
    const result = resultFrom({ ...ran(), running: false }, null);
    expect(result).toEqual(ran());
    expect(result && "running" in result).toBe(false);
  });
  test("a first run still going is no result, and keeps what was held", () => {
    expect(resultFrom({ script: "scripts/fig.py", running: true }, null)).toBeNull();
    const held = ran({ run: 3 });
    expect(resultFrom({ script: "scripts/fig.py", running: true }, held)).toBe(held);
  });
});
