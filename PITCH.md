🚗🧠 OBDient — The brain of the car

📄 [README](./README.md) · 🎤 Pitch (you are here) · 🧠 [Vision](./VISION.md) · 🔧 [Reproducibility](./artifacts/hardware/README.md)


🎯 LOGLINE

We're giving every car a brain — a private AI that understands what's wrong, runs on the device, and gets smarter every time a mechanic confirms a diagnosis.


🔴 THE PROBLEM

Every modern car is full of sensors. It feels everything — temperature, pressure, misfires, vibration — and tells you almost nothing. When something breaks, you get a cryptic orange light 🟠 and a trip to a shop that charges you to read a code your car already knew.

The "fix" the industry offers is worse: connected cars that stream your data to the manufacturer, behind a subscription, dependent on signal. You don't own the intelligence in your own car. They do.


💡 THE SOLUTION

OBDient turns a car's silent sensors into intelligence. Plug a standard OBD-II adapter into any car and OBDient reads the engine in real time and explains what's happening in plain language — using a self-trained AI model that runs 100% on your phone 📱, privately, even with no signal.

This isn't a chatbot wrapped around a cloud API. It's a real diagnostic brain that lives on the device, learns from the people who use it, and needs the cloud less every day.


✅ WHAT WORKS TODAY (on real hardware, in a real car)

👂 It listens. Reads 20 live engine signals through a standard ELM327 adapter.
🧠 It understands. Our own fine-tuned model, CARpsy, explains faults like a mechanic would — on-device, offline, no cloud required.
📈 It learns. Every diagnosis rated good 👍 or bad 👎 sharpens the car's knowledge and makes it more trustworthy over time.
🔒 It's private. The car's data never leaves the device without explicit consent.

Everything above runs today on a real Android phone, a real adapter, and a real car.


⚙️ HOW IT WORKS, IN ONE BREATH

A deterministic router splits every question between two brains: CARpsy on-device for diagnostics (private, offline), and the cloud only for open-ended questions you opt into — and it never receives your VIN or raw sensor data. Every answer is grounded in a knowledge graph that grows and gets more trustworthy with use. The cloud teaches; the device remembers.


🚀 THE STRATEGY — TWO AUDIENCES, ONE BRAIN

Phase 1 builds the brain. Phase 2 sells it.

🔧 PHASE 1 — THE WORKSHOP (audience: mechanics and repair shops)
We deploy OBDient where the best automotive knowledge already lives. A mechanic gets an instant AI diagnosis and confirms or corrects it with professional judgment. Each confirmed diagnosis is a free, expert-labeled training example. The workshops don't just use OBDient — they teach it.

♻️ This is the virtuous cycle:

   ☁️ Claude teaches  →  👨‍🔧 human/car verifies  →  🕸️ knowledge accumulates  →
   🏭 QVAC Fabric retrains CARpsy  →  📉 the cloud is needed less  →  🔁 repeat.

Every turn makes CARpsy smarter and the cloud cheaper. This is the data engine that powers everything after it.

🧠 PHASE 2 — THE CAR'S BRAIN (audience: every driver)
Once the loop has run enough times, CARpsy is good enough to stand on its own — no cloud, no workshop, no subscription. That's when it stops being a mechanic's tool and becomes a consumer product: the brain and the voice 🔊 of the car itself. The Alexa of the car, but private and on-device. You talk to your car; it answers, out loud, and it actually understands what's wrong with itself.


🛣️ THE LONG VISION

Once the brain is trained, it grows:

🍓 It moves into the car. CARpsy runs on a computer the size of a credit card — a Raspberry Pi wired into the vehicle. The car is permanently intelligent, no phone needed.
📡 It grows senses. It fuses engine data with GPS, accelerometer, and impact sensors — so it knows not just how the engine feels, but how the car is moving and what just happened to it.
🚨 It can save your life. If it senses a crash, it can automatically call emergency services and share your exact location, even if you can't.
🕸️ The brains talk to each other. Each car carries its own intelligence, so cars share knowledge directly — no central server. The car ahead hits black ice and the cars behind it already know.
🤝 The network heals itself. When a car is about to be stranded, the network dispatches help that already knows exactly what's broken — an "Uber of technicians," where the diagnosis arrives before the help does, and the brain sends it before the breakdown even happens.


💰 THE BUSINESS — FOUR REVENUE STREAMS THAT FEED EACH OTHER

🔧 Phase 1 — The Workshop: B2B subscription for mechanics.
🚗 Phase 2 — The car's brain: product and hardware for drivers.
🤝 Phase 3 — Rescue network: marketplace commission.
💸 The knowledge economy: agents pay each other tiny stablecoin micropayments (x402) for verified knowledge — settled in Tether's USD₮, on-device, no middleman. Contribute knowledge that helps other cars, and you earn.

Each layer funds and feeds the next. Workshop revenue trains the brain that becomes a consumer product, whose network powers a rescue marketplace and a knowledge economy.


🟢 WHY THIS FITS QVAC AND TETHER

OBDient's primary AI path is 100% on-device through the QVAC SDK — exactly what the platform is built for. The brain itself is trained and retrained on 🏭 QVAC Fabric, fed by the diagnoses confirmed in real workshops. And the endgame is a network of on-device agents paying each other in Tether's stablecoin. QVAC Fabric trains it, QVAC runs it, USD₮ powers its economy: the Tether ecosystem working end to end.


🙌 THE ASK

We've proven the hard part: a private, self-improving diagnostic brain that runs on real hardware today. Help us put it in every workshop — and then in every car.

🚗🧠 We're not building a diagnostic app. We're building the brain of the car.
