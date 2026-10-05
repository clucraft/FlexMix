# FlexMix

A small, mobile-first E85 blend calculator. Enter your tank size, how full it is, the ethanol content the flex fuel sensor reports, and the blend you want. FlexMix tells you how many gallons of E85 and pump gas to add.

After a fill, it can also work out a station's real E85 ethanol content from your flex fuel sensor reading, and remember it per station.

It's a static site (plain HTML, CSS and ES-module JavaScript with no build step and no external requests) served by `nginx:alpine`. Inputs and saved stations are kept in the browser's localStorage.

## Screenshots

| Result | Target out of reach | Input validation |
| :---: | :---: | :---: |
| <img src="docs/screenshots/result-icons.png" width="260" alt="Result: add 6.14 gal E85, then fill 6.76 gal of 93 to reach E40"> | <img src="docs/screenshots/unreachable-icons.png" width="260" alt="Warning: highest possible this fill is E45.0, add E85 only"> | <img src="docs/screenshots/validation-icons.png" width="260" alt="Validation error: E85 ethanol must be higher than pump gas ethanol"> |

| Check station E85 | Saved stations |
| :---: | :---: |
| <img src="docs/screenshots/e85-check.png" width="260" alt="Check station E85 card estimating the station's E85 at E79.2, with a field to remember it as Sheetz Rt 30"> | <img src="docs/screenshots/saved-stations.png" width="260" alt="Station card with a saved station selected, filling in its measured E85 content"> |

<details>
<summary>Full page</summary>

<img src="docs/screenshots/full-page-check.png" width="320" alt="The whole FlexMix page, showing all input cards with Advanced expanded">

</details>

## The math

All percentages are converted to fractions.

| Symbol | Meaning |
| --- | --- |
| C | tank capacity (US gal) |
| L | current fuel level |
| F | fill-to level (default 100%) |
| e0 | current ethanol content |
| et | target ethanol content |
| eg | pump gas ethanol content |
| e85 | E85 ethanol content |

```
V0 = C·L                    fuel in the tank now
Vf = C·F                    fuel after the fill
S  = Vf − V0                gallons to add

x  = (Vf·et − V0·e0 − S·eg) / (e85 − eg)    gallons of E85
y  = S − x                                  gallons of pump gas
blend = (V0·e0 + x·e85 + y·eg) / Vf
```

- If **x < 0**, the target is too low for this fill. The lowest reachable blend is `(V0·e0 + S·eg) / Vf`, and the app shows an all-pump-gas fill.
- If **x > S**, the target is too high. The highest reachable blend is `(V0·e0 + S·e85) / Vf`, and the app shows an all-E85 fill.

Estimated octane is a linear interpolation, and only a rough guide:

```
AKI ≈ pumpAKI + (blend − eg) / (e85 − eg) × (e85AKI − pumpAKI)
```

Ethanol's octane blending isn't linear, so the real number is usually a bit higher at low blends.

**Pump order:** pump the E85 first, then fill the rest with pump gas until the pump shuts off. Any error in the tank-size or fuel-level estimate then lands on the pump-gas side and lowers the ethanol slightly instead of raising it.

## Checking a station's E85

E85 can legally range from 51% to 83% ethanol, so the E85 content you plan with is often a guess. The **Check station E85** card works it out from your flex fuel sensor instead:

1. Plan and pump the fill as usual. Don't change **Current tank** afterwards.
2. Drive 5–10 minutes so the new fuel mixes and reaches the sensor.
3. Open **Check station E85**. It prefills the planned gallons, so correct them to match the pump display, then enter the sensor reading.
4. Tap **Use this value** to copy the result into *E85 ethanol content*. Type a station name first to also remember it under **Saved station** for next time.

It's the same mixing equation, solved for the E85 content, where `x` and `y` are the gallons actually pumped:

```
Vf  = V0 + x + y
e85 = (measured·Vf − V0·e0 − y·eg) / x
```

Sensor error is multiplied by `Vf / x`. On a typical fill (a quarter tank at E30, topped up to E40) a sensor that's 1% off moves the estimate by about 2.8 points. A near-empty tank filled with E85 only cuts that to about 1.1, so that's the best time to check. The app shows this range, and warns when the result is outside 51–83%, impossible, or implies more fuel than the tank holds.

Saved stations show the date they were measured. E85 blends change with the season, so the app suggests re-checking a station after 60 days.

## Project layout

```
src/            web root (copied into the image)
  index.html
  app.js        DOM wiring, localStorage
  calc.js       pure math + validation (unit tested)
  stations.js   saved-station list helpers (unit tested)
  styles.css
  manifest.webmanifest, icon.svg
tests/          calc, E85 check and station tests (node --test)
Dockerfile, nginx.conf, docker-compose.yml
```

## Tests

You need Node 20 or newer. There are no dependencies to install.

```bash
node --test
```

## Run locally

```bash
docker compose up -d --build
```

Then open http://localhost:8085.

## Deploy on Unraid

Clone the repo onto the server and build it from the Unraid terminal (git is included with Unraid):

```bash
git clone https://github.com/clucraft/FlexMix.git /mnt/user/appdata/flexmix
cd /mnt/user/appdata/flexmix
docker compose up -d --build
```

The container then appears on Unraid's **Docker** tab, where you can start, stop, and view its logs like any other container. It restarts automatically (`unless-stopped`).

If your Unraid install doesn't have `docker compose`, plain Docker works too:

```bash
docker build -t flexmix:latest .
docker run -d --name flexmix -p 8085:80 --restart unless-stopped flexmix:latest
```

**Updating:** pull the latest code, rebuild, and clear out the old image:

```bash
cd /mnt/user/appdata/flexmix
git pull && docker compose up -d --build && docker image prune -f
```

**Health:** `docker ps` should show `healthy`, or run `curl http://<unraid-ip>:8085/healthz`.

## Zoraxy reverse proxy

1. In Zoraxy, open **HTTP Proxy → Create Proxy Rules**. (Newer Zoraxy versions call this "Add Proxy Host".)
2. Set **Proxy Type** to *Sub-domain*.
3. Set **Matching keyword / domain** to your hostname, for example `flexmix.example.com`.
4. Set **Target IP address or domain name with port** to `<unraid-ip>:8085`, for example `192.168.1.55:8085` (JUPITER).
5. Leave **Proxy target require TLS connection** unchecked, because the container speaks plain HTTP.
6. Create the rule. If you use DNS, point the hostname at Zoraxy and let Zoraxy's ACME / certificate settings handle HTTPS.

## Add to your phone's home screen

Open the site in your phone browser and choose **Add to Home Screen** (iOS Safari: Share menu; Android Chrome: ⋮ menu). The app has a manifest, an icon and a theme color. There's no service worker, so it needs a network connection to load.
