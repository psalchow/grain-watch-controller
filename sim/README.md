# Fan Control — Local Simulation

Runs the whole fan-control feature locally with an emulated Shelly + contactor
and a seeded InfluxDB. No hardware or production InfluxDB needed.

## Start

    docker compose -f docker-compose.sim.yml up --build

Wait until `influx-seed` exits 0 and the backend logs
`Fan control: manager up, waiting for a stock with fan control`.

## Create the stock

A fresh sim database has no stocks. Log in at http://localhost:5173 as
`admin` / `changeme123`, open the stock administration and choose "New stock"
with these values:

- Device group: `corn-watch-1`
- Outdoor device: `corn-watch-1`
- Fan control enabled, topic prefix `/corn-watch/actors/corn-watch-1/fan-control`,
  switch id `0`

The first stock gets the id `stk_001`.

## Open

- Frontend: http://localhost:5173 — open the new stock → "Lüfter steuern"
  (sub-screen), or go directly to http://localhost:5173/stocks/stk_001/fan
- Shelly emulator UI: http://localhost:8080

## Try it

1. **Normal switch on:** In the frontend fan screen click "Einschalten". The
   emulator UI shows Output EIN, Schütz angezogen; the frontend goes
   TURN_ON_PENDING → ON. The MQTT log shows the `command`, `status` and
   `monitor/status` (success) messages.
2. **Contactor won't engage:** In the emulator UI set "Schütz beim nächsten
   Schalten" → "Zieht nicht an", then switch on from the frontend. After ~3 s
   the emulator publishes `alert` + `safety_shutoff`; the frontend shows FAULT.
3. **Manual contactor switch:** Click "Lüfter/Schütz manuell schalten" — the
   emulator publishes a `warning` and the frontend shows the warning overlay.
4. **Shelly offline:** Click "Shelly offline schalten" — the fan card's
   reachability badge switches to "Steuerung nicht erreichbar".
5. **Keep-alive / auto-off:** With the fan ON, watch the MQTT log — the backend
   re-asserts `on` every 30 s. To see auto-off quickly, set
   `SHELLY_AUTO_OFF_MS` (e.g. `120000`) in `docker-compose.sim.yml`.

## Manual switching directly at the Shelly

The emulator UI "Shelly EIN/AUS" buttons switch the output directly (as if
toggled on the device). With the fan desired OFF in the backend this surfaces
as unexpected switching.

## Stop

    docker compose -f docker-compose.sim.yml down -v
