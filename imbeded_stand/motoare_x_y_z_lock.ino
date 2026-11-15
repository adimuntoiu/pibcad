#include <SPI.h>
#include <TMCStepper.h>

// ---------------- Pini motor X (Einsy Rambo) ----------------
#define X_STEP_PIN         37
#define X_DIR_PIN          49
#define X_ENABLE_PIN       29
#define X_CS_PIN           41

// ---------------- Pini motor Y (Einsy Rambo) ----------------
#define Y_STEP_PIN         36
#define Y_DIR_PIN          48
#define Y_ENABLE_PIN       28
#define Y_CS_PIN           39

// ---------------- Pini motor Z (Einsy Rambo) ----------------
#define Z_STEP_PIN         35
#define Z_DIR_PIN          47
#define Z_ENABLE_PIN       27
#define Z_CS_PIN           67

// ---------------- Senzori Hall ----------------
#define HALL_SENSOR_Z_PIN  10   // conectorul Probe, pinul S
#define HALL_SENSOR_Y_PIN  11   // conectorul Y (Endstops), pinul S

#define R_SENSE            0.11f

TMC2130Stepper driverX(X_CS_PIN, R_SENSE);
TMC2130Stepper driverY(Y_CS_PIN, R_SENSE);
TMC2130Stepper driverZ(Z_CS_PIN, R_SENSE);

// ---------------- Parametri mecanici ----------------
const int   PASI_PE_TURA_MOTOR   = 200;
const int   MICROSTEPS           = 16;
const float RAPORT_REDUCTOR      = 12.0;
const float UNGHI_TINTA_GRADE    = 90.0;

const long  PASI_PE_TURA_MICROSTEP = (long)PASI_PE_TURA_MOTOR * MICROSTEPS; // 3200
const long  PASI_TINTA = (long)((UNGHI_TINTA_GRADE / 360.0) * RAPORT_REDUCTOR * PASI_PE_TURA_MICROSTEP); // 9600
const long  PASI_MAX_SIGURANTA = PASI_TINTA * 2;

// ---------------- Profil de viteza ----------------
const unsigned int DELAY_MAX_US = 1400;
const unsigned int DELAY_MIN_US = 350;
const long  PASI_ACCELERARE = PASI_TINTA * 0.30;
const long  PASI_DECELERARE = PASI_TINTA * 0.30;

// ---------------- Pauza intre cele doua rotatii ----------------
const unsigned long PAUZA_MS = 30000; // 30 secunde, motorul sta blocat (ENABLE activ)

// ---------------- Motor X: pasi simpli ----------------
const int   PASI_X = 10;
const unsigned int DELAY_PASI_X_US = 1000;
int pasXCurent = 0;

// ---------------- Motoare cu rampa (Y si Z), non-blocant ----------------
enum StareMotor {
  RAMPA_1,     // prima rotatie pana la magnet
  ASTEPTARE,   // blocat, asteapta 30 s
  RAMPA_2,     // a doua rotatie pana la magnet
  GATA         // unlock, motor liber
};

struct MotorRampa {
  const char*   nume;
  uint8_t       stepPin;
  uint8_t       enablePin;
  uint8_t       hallPin;
  StareMotor    stare;
  long          pas;
  unsigned long urmatorulMicros;
  unsigned int  delayCurent;
  bool          pinHigh;
  bool          senzorLiberat;   // a 2-a rotatie: magnetul trebuie intai sa iasa din dreptul senzorului
  unsigned long startAsteptare;
};

MotorRampa motorY = {"Y", Y_STEP_PIN, Y_ENABLE_PIN, HALL_SENSOR_Y_PIN, RAMPA_1, 0, 0, 0, false, false, 0};
MotorRampa motorZ = {"Z", Z_STEP_PIN, Z_ENABLE_PIN, HALL_SENSOR_Z_PIN, RAMPA_1, 0, 0, 0, false, false, 0};

enum EtapaGlobala {
  ETAPA_X_10_PASI,
  ETAPA_Y_Z,
  ETAPA_TERMINAT
};
EtapaGlobala etapa = ETAPA_X_10_PASI;

void initDriver(TMC2130Stepper &drv, uint8_t stepPin, uint8_t dirPin, uint8_t enPin, bool dirHigh) {
  pinMode(stepPin, OUTPUT);
  pinMode(dirPin, OUTPUT);
  pinMode(enPin, OUTPUT);
  digitalWrite(enPin, HIGH); // dezactivat pana ii vine randul

  drv.begin();
  drv.toff(4);
  drv.vsense(0);
  drv.rms_current(1000);
  drv.microsteps(MICROSTEPS);
  drv.en_pwm_mode(0);

  digitalWrite(dirPin, dirHigh ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);

  pinMode(53, OUTPUT);
  digitalWrite(53, HIGH);

  SPI.begin();

  pinMode(HALL_SENSOR_Z_PIN, INPUT_PULLUP); // senzori activi pe LOW
  pinMode(HALL_SENSOR_Y_PIN, INPUT_PULLUP);

  initDriver(driverX, X_STEP_PIN, X_DIR_PIN, X_ENABLE_PIN, false);
  initDriver(driverY, Y_STEP_PIN, Y_DIR_PIN, Y_ENABLE_PIN, true);
  initDriver(driverZ, Z_STEP_PIN, Z_DIR_PIN, Z_ENABLE_PIN, true);

  Serial.print("Senzor Hall Z: ");
  Serial.println(digitalRead(HALL_SENSOR_Z_PIN) == LOW ? "LOW (magnet/cablaj?)" : "HIGH (ok)");
  Serial.print("Senzor Hall Y: ");
  Serial.println(digitalRead(HALL_SENSOR_Y_PIN) == LOW ? "LOW (magnet/cablaj?)" : "HIGH (ok)");

  digitalWrite(X_ENABLE_PIN, LOW);
  Serial.println("Pornim: motorul X face 10 pasi...");
  delay(500);
}

unsigned int calculDelay(long pas, long totalPasi) {
  if (pas < PASI_ACCELERARE) {
    float progres = (float)pas / (float)PASI_ACCELERARE;
    return DELAY_MAX_US - (unsigned int)(progres * (DELAY_MAX_US - DELAY_MIN_US));
  }

  long pasiRamasi = totalPasi - pas;
  if (pasiRamasi < PASI_DECELERARE && pasiRamasi >= 0) {
    float progres = (float)pasiRamasi / (float)PASI_DECELERARE;
    progres = constrain(progres, 0.0, 1.0);
    return DELAY_MAX_US - (unsigned int)(progres * (DELAY_MAX_US - DELAY_MIN_US));
  }

  if (pasiRamasi < 0) return DELAY_MAX_US;
  return DELAY_MIN_US;
}

// Se apeleaza la fiecare loop(); face cel mult o jumatate de puls de pas
void ruleazaMotor(MotorRampa &m) {
  if (m.stare == GATA) return;

  // ---- Pauza de 30 s: motorul ramane blocat (ENABLE ramane LOW) ----
  if (m.stare == ASTEPTARE) {
    if (millis() - m.startAsteptare >= PAUZA_MS) {
      m.pas = 0;
      m.pinHigh = false;
      m.senzorLiberat = false;
      m.urmatorulMicros = micros();
      m.stare = RAMPA_2;
      Serial.print(m.nume);
      Serial.println(": au trecut 30 s, pornesc a doua rotatie...");
    }
    return;
  }

  // ---- RAMPA_1 / RAMPA_2 ----
  unsigned long acum = micros();
  if ((long)(acum - m.urmatorulMicros) < 0) return;

  if (!m.pinHigh) {
    bool magnet = (digitalRead(m.hallPin) == LOW);

    // La a doua rotatie pornim chiar din dreptul magnetului: il ignoram
    // pana cand senzorul citeste o data HIGH (magnetul a iesit din zona)
    if (m.stare == RAMPA_2 && !m.senzorLiberat) {
      if (!magnet) m.senzorLiberat = true;
      magnet = false;
    }

    if (magnet) {
      if (m.stare == RAMPA_1) {
        // Prima detectie: LOCK - ENABLE ramane LOW, motorul tine pozitia
        m.stare = ASTEPTARE;
        m.startAsteptare = millis();
        Serial.print(m.nume);
        Serial.print(": magnet detectat (1/2) dupa ");
        Serial.print(m.pas);
        Serial.println(" pasi. Motor blocat 30 s.");
      } else {
        // A doua detectie: UNLOCK - driver dezactivat, motor liber
        digitalWrite(m.enablePin, HIGH);
        m.stare = GATA;
        Serial.print(m.nume);
        Serial.print(": magnet detectat (2/2) dupa ");
        Serial.print(m.pas);
        Serial.println(" pasi. Motor deblocat (liber).");
      }
      return;
    }

    if (m.pas >= PASI_MAX_SIGURANTA) {
      digitalWrite(m.enablePin, HIGH);
      m.stare = GATA;
      Serial.print("EROARE: ");
      Serial.print(m.nume);
      Serial.println(" - magnetul nu a fost detectat in limita de siguranta! Motor deblocat.");
      return;
    }

    m.delayCurent = calculDelay(m.pas, PASI_TINTA);
    digitalWrite(m.stepPin, HIGH);
    m.pinHigh = true;
    m.urmatorulMicros = acum + m.delayCurent;
  } else {
    digitalWrite(m.stepPin, LOW);
    m.pinHigh = false;
    m.pas++;
    m.urmatorulMicros = acum + m.delayCurent;
  }
}

void loop() {
  switch (etapa) {

    case ETAPA_X_10_PASI: {
      if (pasXCurent < PASI_X) {
        digitalWrite(X_STEP_PIN, HIGH);
        delayMicroseconds(DELAY_PASI_X_US);
        digitalWrite(X_STEP_PIN, LOW);
        delayMicroseconds(DELAY_PASI_X_US);
        pasXCurent++;
      } else {
        digitalWrite(X_ENABLE_PIN, HIGH);
        Serial.println("X a terminat cei 10 pasi. Pornim Y si Z...");

        digitalWrite(Y_ENABLE_PIN, LOW);
        digitalWrite(Z_ENABLE_PIN, LOW);
        motorY.urmatorulMicros = micros();
        motorZ.urmatorulMicros = micros();
        etapa = ETAPA_Y_Z;
      }
      break;
    }

    case ETAPA_Y_Z: {
      ruleazaMotor(motorY);
      ruleazaMotor(motorZ);

      if (motorY.stare == GATA && motorZ.stare == GATA) {
        etapa = ETAPA_TERMINAT;
        Serial.println("Y si Z deblocate. Secventa terminata.");
      }
      break;
    }

    case ETAPA_TERMINAT:
      break;
  }
}
