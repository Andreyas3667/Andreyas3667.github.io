/* BackupWatch core: parse backup job logs, detect anomalies with robust statistics. */
(function (root) {
  "use strict";

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const DAY = 86400000;
  const iso = (d) => new Date(d).toISOString().slice(0, 16).replace("T", " ");

  // ---------- sample log modelled on a small-office TrueNAS SCALE setup ----------
  function sampleCSV(endDate = Date.UTC(2026, 9, 21, 23, 0)) {
    const R = rng(42);
    const jobs = [
      { job: "finance-share-snapshot", hour: 22, size: 182, growth: 0.25, dur: 6, changed: 1.2 },
      { job: "erp-database-dump", hour: 23, size: 46, growth: 0.08, dur: 14, changed: 4.5 },
      { job: "documents-offsite-sync", hour: 1, size: 640, growth: 0.9, dur: 52, changed: 0.8 },
    ];
    const days = 60, start = endDate - (days - 1) * DAY;
    const rows = [["timestamp", "job", "status", "size_gb", "duration_min", "changed_pct"]];
    jobs.forEach((j, ji) => {
      let size = j.size;
      for (let d = 0; d < days; d++) {
        const t = start + d * DAY + j.hour * 3600000 + Math.floor(R() * 20) * 60000;
        size += j.growth * (0.6 + R() * 0.8);
        let s = size, dur = j.dur * (0.85 + R() * 0.3), ch = j.changed * (0.7 + R() * 0.6), status = "success";
        const weekend = new Date(t).getUTCDay() % 6 === 0;
        if (weekend) { ch *= 0.4; dur *= 0.9; }
        // injected incidents
        if (ji === 0 && d === 18) { s = size * 0.38; ch = 61; }                         // mass deletion
        if (ji === 0 && d === 51) { ch = 92; dur *= 3.4; s = size * 1.03; }               // ransomware-like rewrite
        if (ji === 1 && (d === 33 || d === 34)) continue;                                 // two missed runs
        if (ji === 1 && d === 44) { status = "failed"; s = 0; dur = 1.2; ch = 0; }        // failed dump
        if (ji === 2 && d >= 26 && d <= 28) dur *= 2.6 + R();                             // slow offsite link
        if (ji === 2 && d === 57) { status = "warning"; }
        rows.push([iso(t), j.job, status, s.toFixed(2), dur.toFixed(1), ch.toFixed(2)]);
      }
    });
    const header = rows.shift();
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    return [header].concat(rows).map((r) => r.join(",")).join("\n");
  }

  // ---------- parsing ----------
  const NEED = ["timestamp", "job", "status", "size_gb", "duration_min"];
  function parseCSV(text) {
    const lines = String(text).replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (!lines.length) throw new Error("The file is empty.");
    const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const missing = NEED.filter((n) => !head.includes(n));
    if (missing.length) throw new Error(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected: timestamp, job, status, size_gb, duration_min, changed_pct (optional).`);
    const col = (n) => head.indexOf(n);
    const runs = []; const bad = [];
    lines.slice(1).forEach((l, i) => {
      const c = l.split(",").map((x) => x.trim());
      const t = Date.parse(c[col("timestamp")].replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(c[col("timestamp")]) ? "" : "Z"));
      const size = parseFloat(c[col("size_gb")]), dur = parseFloat(c[col("duration_min")]);
      const ch = col("changed_pct") >= 0 ? parseFloat(c[col("changed_pct")]) : NaN;
      if (!isFinite(t) || !c[col("job")]) { bad.push(i + 2); return; }
      runs.push({ t, job: c[col("job")], status: (c[col("status")] || "").toLowerCase(), size: isFinite(size) ? size : 0, dur: isFinite(dur) ? dur : 0, changed: isFinite(ch) ? ch : null });
    });
    if (!runs.length) throw new Error("No readable rows. Check that timestamps look like 2026-10-21 22:05.");
    runs.sort((a, b) => a.t - b.t);
    return { runs, badRows: bad };
  }

  // ---------- statistics ----------
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  function robustZ(x, base) {
    const med = median(base);
    const mad = median(base.map((v) => Math.abs(v - med))) || (Math.abs(med) * 0.02) || 1e-6;
    return { z: (0.6745 * (x - med)) / mad, med };
  }

  // ---------- detection ----------
  function analyse(runs, opts = {}) {
    const WINDOW = opts.window || 14, Z = opts.threshold || 3.5;
    const byJob = {};
    runs.forEach((r) => (byJob[r.job] = byJob[r.job] || []).push(r));
    const alerts = [], jobs = [];
    const now = opts.now || runs[runs.length - 1].t;
    for (const name of Object.keys(byJob)) {
      const rs = byJob[name];
      const okRuns = rs.filter((r) => r.status === "success");
      const gaps = rs.slice(1).map((r, i) => r.t - rs[i].t);
      const interval = gaps.length ? median(gaps) : DAY;
      rs.forEach((r, i) => {
        r.flags = [];
        if (r.status === "failed" || r.status === "error") alerts.push(mk(r, "critical", "Backup failed", `The job reported "${r.status}". No new restore point was created for this run.`, "Check the job log on the NAS, fix the cause and run the job manually today."));
        else if (r.status === "warning") alerts.push(mk(r, "warning", "Finished with warnings", "The job completed but reported warnings, so some files may have been skipped.", "Open the job log and confirm which files were skipped (locked or permission-denied files are common)."));
        if (i > 0) {
          const gap = r.t - rs[i - 1].t;
          if (gap > interval * 1.6) {
            const missed = Math.round(gap / interval) - 1;
            alerts.push(mk(r, "high", `${missed} scheduled run${missed > 1 ? "s" : ""} missed`, `${(gap / 3600000).toFixed(0)} hours passed between runs; this job normally runs every ${(interval / 3600000).toFixed(0)} hours.`, "Check whether the schedule was disabled, the NAS was offline, or the job overlapped with maintenance.", rs[i - 1].t));
          }
        }
        const prior = rs.slice(Math.max(0, i - WINDOW), i).filter((p) => p.status === "success");
        if (prior.length < 5 || r.status !== "success") return;
        const sz = robustZ(r.size, prior.map((p) => p.size));
        if (sz.z < -Z && r.size < sz.med * 0.9) { const drop = (1 - r.size / sz.med) * 100; r.flags.push("size"); alerts.push(mk(r, drop > 30 ? "critical" : "high", `Backup size dropped ${drop.toFixed(0)}%`, `This run stored ${r.size.toFixed(1)} GB against a recent median of ${sz.med.toFixed(1)} GB. Large drops usually mean files were deleted or moved at the source.`, "Confirm with the data owner whether the deletion was intended. If not, restore from the previous snapshot before it ages out.")); }
        else if (sz.z > Z && r.size > sz.med * 1.15) { r.flags.push("size"); alerts.push(mk(r, "warning", "Backup size jumped", `This run stored ${r.size.toFixed(1)} GB against a recent median of ${sz.med.toFixed(1)} GB.`, "Check for unexpected large files (video, disk images, duplicated folders) and remaining capacity.")); }
        const du = robustZ(r.dur, prior.map((p) => p.dur));
        if (du.z > Z && r.dur > du.med * 1.5) { r.flags.push("duration"); alerts.push(mk(r, "warning", `Run took ${(r.dur / du.med).toFixed(1)}× longer than usual`, `${r.dur.toFixed(0)} minutes against a median of ${du.med.toFixed(0)} minutes.`, "Check disk health (SMART), network throughput to the target and whether another job overlapped.")); }
        if (r.changed != null && prior.every((p) => p.changed != null)) {
          const cz = robustZ(r.changed, prior.map((p) => p.changed));
          if (cz.z > Z && r.changed > 20) { r.flags.push("changed"); alerts.push(mk(r, "critical", `${r.changed.toFixed(0)}% of files changed in one run`, `Normally about ${cz.med.toFixed(1)}% of files change. Mass changes across a share are a classic sign of ransomware encrypting files.`, "Isolate the share (make it read-only), check a sample of files and keep older snapshots locked until cleared.")); }
        }
      });
      const lastOk = okRuns.length ? okRuns[okRuns.length - 1] : null;
      const ageH = lastOk ? (now - lastOk.t) / 3600000 : Infinity;
      jobs.push({ name, runs: rs, interval, lastOk, ageH, overdue: ageH > (interval / 3600000) * 1.6 });
    }
    const order = { critical: 0, high: 1, warning: 2 };
    alerts.sort((a, b) => order[a.severity] - order[b.severity] || b.t - a.t);
    return { jobs, alerts };
    function mk(r, severity, title, detail, action, since) { return { t: r.t, since, job: r.job, severity, title, detail, action }; }
  }

  const api = { DAY, sampleCSV, parseCSV, analyse, robustZ, median };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BackupCore = api;
})(typeof window !== "undefined" ? window : globalThis);
