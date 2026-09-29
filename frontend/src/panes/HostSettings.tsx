import { useEffect, useState, type ReactNode } from "react";
import api, { type HostState, type PairedInstall } from "../api";
import { Button } from "../ui/Button";
import { Field, Row, Switch, useLabelId } from "../ui/controls";
import { HostIcon, PeopleIcon } from "../ui/icons";

/** The always-on host, in "This install", as the direction page's "The
 *  always-on host, in settings" draws it.
 *
 *  Two sides of one idea on one install. As a host: the switch, the
 *  pairing code to hand out, the installs that paired with it, and the
 *  projects it keeps. As a writer: the hosts this install is paired with,
 *  and the way to add one with a code. The host's side shows only while
 *  the switch is on, so an install that is not a host carries one row
 *  about it and the writer's list. */
export default function HostSettings() {
  const [state, setState] = useState<HostState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const switchId = useLabelId();

  useEffect(() => {
    let live = true;
    api.host().then((got) => { if (live) setState(got); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const run = async (act: () => Promise<HostState>, failed: string) => {
    setBusy(true);
    setError("");
    try {
      setState(await act());
      return true;
    } catch (caught: any) {
      setError(caught?.message || failed);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!state?.code) return;
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy. Select the code and copy it by hand.");
    }
  };

  if (!state) return null;
  const kept = state.kept.filter((project) => !project.missing).length;

  return (
    <>
      <div className="nx-settings-row" data-testid="host-row">
        <div className="nx-settings-text">
          <span id={switchId}>Always-on host</span>
          <small>Keeps the projects paired installs share with it in step, with nothing open.</small>
        </div>
        <Switch
          checked={state.host}
          aria-labelledby={switchId}
          data-testid="host-switch"
          disabled={busy}
          onChange={(on) => void run(() => api.setHost(on), "Could not change host mode.")}
        />
      </div>

      {state.host ? (
        <>
          <div className="nx-settings-row" data-stack="" data-testid="host-code-row">
            <div className="nx-settings-text">
              <span>Pairing code</span>
              <small>Give this to anyone whose shared projects this install should keep.</small>
            </div>
            {state.code ? (
              <Field
                readOnly
                value={state.code}
                aria-label="This host's pairing code"
                data-testid="host-code"
                frameClassName="w-full"
                className="nx-field-mono"
                onFocus={(event) => event.currentTarget.select()}
                trailing={
                  <Button size="inline" className="shrink-0" data-testid="host-code-copy" onClick={copy}>
                    {copied ? "Copied" : "Copy"}
                  </Button>
                }
              />
            ) : (
              <small className="text-small text-ink-3">This install is not reachable yet. Open this again in a moment.</small>
            )}
          </div>

          {state.boot === "no" ? (
            <div className="nx-settings-row" data-testid="host-boot-row">
              <div className="nx-settings-text">
                <span>Start at boot</span>
                <small>{state.said || "Right now NextTex starts only once you log in to this machine."}</small>
              </div>
              <Button
                variant="ghost"
                data-testid="host-boot"
                disabled={busy}
                onClick={() => void run(() => api.hostStartsAtBoot(), "Could not ask the machine.")}
              >
                Start at boot
              </Button>
            </div>
          ) : null}

          {state.paired.length ? (
            <div className="nx-settings-list" data-testid="host-paired">
              <div className="nx-settings-label">Paired installs</div>
              {state.paired.map((install) => (
                <Paired
                  key={install.peer}
                  install={install}
                  icon={<PeopleIcon />}
                  onRemove={() => void run(() => api.unpairWriter(install.peer), "Could not remove it.")}
                />
              ))}
            </div>
          ) : null}

          <div className="nx-settings-row" data-testid="host-kept">
            <div className="nx-settings-text">
              <span>Kept projects</span>
              <small>
                {kept === 1 ? "1 project" : `${kept} projects`}, in{" "}
                <span className="font-mono">{state.root}</span>
              </small>
            </div>
          </div>
        </>
      ) : null}

      <div className="nx-settings-row" data-testid="hosts-row">
        <div className="nx-settings-text">
          <span>Hosts</span>
          <small>Installs that keep your shared projects in step while you are away.</small>
        </div>
        {adding ? null : (
          <Button variant="ghost" data-testid="host-add" onClick={() => setAdding(true)}>
            Add a host
          </Button>
        )}
      </div>
      {adding ? (
        <div className="nx-settings-add" data-testid="host-add-form">
          <Field
            autoFocus
            value={code}
            placeholder="nexttex-host-v1-…"
            aria-label="The host's pairing code"
            data-testid="host-add-code"
            frameClassName="w-full"
            className="nx-field-mono"
            onChange={(event) => setCode(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAdding(false);
            }}
          />
          <Button variant="quiet" onClick={() => { setAdding(false); setCode(""); }}>Cancel</Button>
          <Button
            variant="pen"
            data-testid="host-pair"
            disabled={busy || !code.trim()}
            onClick={async () => {
              if (await run(() => api.pairHost(code.trim()), "Could not pair with that host.")) {
                setAdding(false);
                setCode("");
              }
            }}
          >
            {busy ? "Pairing…" : "Pair"}
          </Button>
        </div>
      ) : null}
      {state.hosts.length ? (
        <div className="nx-settings-list" data-testid="hosts-list">
          {state.hosts.map((install) => (
            <Paired
              key={install.peer}
              install={install}
              icon={<HostIcon />}
              onRemove={() => void run(() => api.unpairHost(install.peer), "Could not remove it.")}
            />
          ))}
        </div>
      ) : null}

      {error ? <p className="nx-note text-error" data-testid="host-error">{error}</p> : null}
    </>
  );
}

/** One paired install: its name, whether a link to it is up, and Remove
 *  under the pointer in place of that. */
function Paired({ install, icon, onRemove }: {
  install: PairedInstall;
  icon: ReactNode;
  onRemove: () => void;
}) {
  return (
    <Row
      size="md"
      className="nx-paired"
      data-testid="paired-row"
      leading={<span className="nx-paired-icon" aria-hidden="true">{icon}</span>}
      trailingAlways
      trailing={
        <>
          <span className="nx-paired-state" data-connected={install.connected ? "true" : undefined}>
            {install.connected ? "connected" : "not connected"}
          </span>
          <Button variant="quiet" size="inline" className="nx-paired-remove" data-testid="paired-remove" onClick={onRemove}>
            Remove
          </Button>
        </>
      }
    >
      {install.name || "Unnamed"}
    </Row>
  );
}
