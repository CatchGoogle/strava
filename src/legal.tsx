const SUPPORT = "https://github.com/CatchGoogle/strava/issues";

export function pageFromHash(): "studio" | "privacy" | "terms" {
  if (window.location.hash === "#privacy") return "privacy";
  if (window.location.hash === "#terms") return "terms";
  return "studio";
}

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  return (
    <article className="legal">
      <a className="legal-back" href="#studio">
        Back to TRACE
      </a>
      {kind === "privacy" ? <Privacy /> : <Terms />}
    </article>
  );
}

function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <p>TRACE runs in your browser. It has no server of its own. This notice covers a Strava connection.</p>
      <h2>What is collected</h2>
      <p>
        If you connect Strava, TRACE requests <em>activity:read_all</em> and receives your athlete name, activity names,
        dates, sport, distance, and moving time, plus the GPS track, elevation, timestamps, and heart rate of an activity
        you open. The client ID and client secret you paste, and the Strava access and refresh tokens, stay in this
        browser’s local storage.
      </p>
      <h2>How it is collected</h2>
      <p>
        You approve access on Strava. TRACE then calls Strava’s API from this browser. The route you open is kept in
        memory for that visit. It is not uploaded anywhere and it is not saved as a library of activities.
      </p>
      <h2>Who can see it</h2>
      <p>
        A Strava route is shown only in this browser, to the person who connected that account. TRACE does not publish
        it, sell it, use it for advertising, or use it to train or operate an AI system. A poster you download is a file
        on your device.
      </p>
      <h2>Strava’s own records</h2>
      <p>
        Strava may monitor and collect data about requests this app makes to the Strava API, and may use that data for
        its business purposes, including support, improving the API, and checking compliance with Strava’s terms.
      </p>
      <h2>Withdrawing consent</h2>
      <p>
        Choose Disconnect or Delete my Strava data in TRACE, or revoke the API app at{" "}
        <a href="https://www.strava.com/settings/apps" target="_blank" rel="noreferrer">
          strava.com/settings/apps
        </a>
        . Your Strava account is at{" "}
        <a href="https://www.strava.com/dashboard" target="_blank" rel="noreferrer">
          strava.com/dashboard
        </a>
        .
      </p>
      <h2>Deletion</h2>
      <p>
        Delete my Strava data removes the Strava login, the activity list, the saved API client ID and secret, and any
        Strava route loaded in this browser, then shows the date and time that deletion finished. Disconnect does the
        same for the login, the list, and a loaded Strava route, and leaves the API client ID and secret so you can
        connect again. Neither action deletes activities on Strava. If Strava rejects the login, TRACE deletes the same
        browser copy and shows the same confirmation.
      </p>
      <h2>Support</h2>
      <p>
        Questions and deletion requests:{" "}
        <a href={SUPPORT} target="_blank" rel="noreferrer">
          github.com/CatchGoogle/strava/issues
        </a>
        .
      </p>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms</h1>
      <p>
        TRACE is an independent route-poster tool. It is not developed, sponsored, or endorsed by Strava. “Compatible
        with Strava” describes the optional login, not an affiliation.
      </p>
      <p>You must be 18 or older to register a Strava API application and connect it here. You connect your own account and view your own activities.</p>
      <p>
        TRACE is provided as is and as available, without warranty of any kind. On behalf of third-party service
        providers, including Strava, all warranties are disclaimed, including implied warranties of merchantability,
        fitness for a particular purpose, and non-infringement. Those providers are excluded from liability for
        consequential, special, punitive, and indirect damages arising out of TRACE or your use of their services.
      </p>
      <p>
        Support is at{" "}
        <a href={SUPPORT} target="_blank" rel="noreferrer">
          github.com/CatchGoogle/strava/issues
        </a>
        . Strava does not provide support for TRACE.
      </p>
    </>
  );
}
