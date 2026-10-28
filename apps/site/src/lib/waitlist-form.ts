// The waitlist form, with the script: a JSON post to api/waitlist.ts. A field's
// error shows under that field (aria-invalid, aria-describedby); the result is
// said in the status line (role="status"). Without the script the form posts
// itself and the function's 303 lands on a :target message.

const MESSAGES = {
  ok: "You are on the list. We email you if a hosted version ships.",
  invalid_email: "Enter a valid email address.",
  invalid_note: "Keep the note to 280 characters.",
  failed: "The waitlist did not take your email. Try again later.",
} as const;

type FieldName = "email" | "note";

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-waitlist]")) {
  const status = form.querySelector<HTMLElement>("[data-waitlist-status]");
  const text = status?.querySelector<HTMLElement>("[data-waitlist-text]");
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const inputs = {
    email: form.querySelector<HTMLInputElement>('[name="email"]'),
    note: form.querySelector<HTMLTextAreaElement>('[name="note"]'),
  };
  if (!status || !text || !button || !inputs.email || !inputs.note) continue;
  const label = button.textContent?.trim() ?? "";

  const say = (state: "ok" | "error" | "", message: string) => {
    status.dataset.state = state;
    text.textContent = message;
  };

  const errorOf = (name: FieldName) => document.getElementById(`waitlist-${name}-error`);

  const clear = (name: FieldName) => {
    const input = inputs[name]!;
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    const error = errorOf(name);
    if (error) error.textContent = "";
  };

  const invalid = (name: FieldName, message: string) => {
    const input = inputs[name]!;
    const error = errorOf(name);
    if (error) {
      error.textContent = message;
      input.setAttribute("aria-describedby", error.id);
    }
    input.setAttribute("aria-invalid", "true");
    input.focus();
  };

  // The fields and the button go; the status line, with its check, takes their place.
  const done = (focus: boolean) => {
    form.dataset.state = "ok";
    say("ok", MESSAGES.ok);
    if (focus) status.focus();
  };

  // The button keeps focus while a post runs: aria-disabled, not disabled.
  const busy = (on: boolean) => {
    if (on) {
      button.setAttribute("aria-disabled", "true");
      form.setAttribute("aria-busy", "true");
      button.textContent = "Joining";
    } else {
      button.removeAttribute("aria-disabled");
      form.removeAttribute("aria-busy");
      button.textContent = label;
    }
  };

  // From here the status line says every result, so the :target notes stay hidden.
  form.dataset.js = "";
  // The function checks the email; the browser's own bubble would be a second voice.
  form.noValidate = true;

  // An edit clears that field's error and a store error; the next post says the new result.
  for (const name of ["email", "note"] as const) {
    inputs[name]!.addEventListener("input", () => {
      clear(name);
      if (status.dataset.state === "error") say("", "");
    });
  }

  // Back from a post that ran before this script: say what the function answered,
  // bring the section into view, and drop the query so a reload or a shared link says nothing.
  const landed = new URLSearchParams(location.search).get("waitlist");
  if (landed === "ok" || landed === "error") {
    if (landed === "ok") done(false);
    else say("error", MESSAGES.failed);
    document.getElementById("waitlist")?.scrollIntoView({ block: "start" });
    history.replaceState(null, "", `${location.pathname}#waitlist`);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.getAttribute("aria-disabled") === "true") return;
    const body = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)]));
    clear("email");
    clear("note");
    if (!/\S@\S/.test(body.email ?? "")) {
      say("", "");
      invalid("email", MESSAGES.invalid_email);
      return;
    }
    busy(true);
    say("", "");
    try {
      const res = await fetch(form.action, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      const reply = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && reply?.ok) {
        form.reset();
        done(true);
      } else if (reply?.error === "invalid_email") {
        invalid("email", MESSAGES.invalid_email);
      } else if (reply?.error === "invalid_note") {
        invalid("note", MESSAGES.invalid_note);
      } else {
        say("error", MESSAGES.failed);
      }
    } catch {
      say("error", MESSAGES.failed);
    } finally {
      busy(false);
    }
  });
}
