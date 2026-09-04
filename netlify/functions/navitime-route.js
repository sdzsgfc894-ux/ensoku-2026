function cleanEnv(v) {
  return String(v || "").trim().replace(/^["']|["']$/g, "");
}

const ROUTE_URL = cleanEnv(process.env.NAVITIME_ROUTE_URL);

function tollFromFare(fare) {
  if (!fare || typeof fare !== "object") return null;

  const keys = Object.keys(fare);

  const preferred =
    keys.find(k => /^unit_1025_1$/.test(k)) ||
    keys.find(k => /_1$/.test(k));

  return preferred ? Number(fare[preferred]) : null;
}

async function routeOne(start, goal, key) {
  if (!ROUTE_URL) {
    throw new Error(
      "NAVITIME_ROUTE_URL が未設定です。"
    );
  }

  const u = new URL(ROUTE_URL);

  u.searchParams.set(
    "start",
    `${start.lat},${start.lon}`
  );

  u.searchParams.set(
    "goal",
    `${goal.lat},${goal.lon}`
  );

  u.searchParams.set("condition", "toll_time");
  u.searchParams.set("no", "1");

  const r = await fetch(u, {
    headers: {
      "X-SBIAPI-Key": key,
      "X-Sbiapi-User-Appkey": key,
      "X-SBIAPI-Host": "https://proxy.sbi-digitalhub.co.jp"
    }
  });

  const text = await r.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `NAVITIME API応答をJSONとして読めませんでした (${r.status})`
    );
  }

  if (!r.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `NAVITIME API error ${r.status}`
    );
  }

  const item = data.items?.[0];
  const move = item?.summary?.move;

  if (!move) {
    throw new Error(
      "ルート結果にsummary.moveがありません"
    );
  }

  return {
    time: Number(move.time || 0),
    distance: Number(move.distance || 0),
    toll: tollFromFare(move.fare)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({
        error: "POST only"
      })
    };
  }

  try {
    const key = process.env.SBI_NAVITIME_KEY;

    if (!key) {
      throw new Error(
        "SBI_NAVITIME_KEY が未設定です"
      );
    }

    const {
      originGeo,
      stops
    } = JSON.parse(event.body || "{}");

    if (
      !originGeo?.lat ||
      !originGeo?.lon ||
      !Array.isArray(stops) ||
      !stops.length
    ) {
      throw new Error(
        "出発地または目的地の位置情報がありません"
      );
    }

    const points = [
      {
        lat: Number(originGeo.lat),
        lon: Number(originGeo.lon),
        label: originGeo.label || "出発地"
      },

      ...stops.map(s => ({
        lat: Number(s.lat),
        lon: Number(s.lon),
        label: s.name,
        name: s.name
      }))
    ];

    if (
      points.some(
        p =>
          !Number.isFinite(p.lat) ||
          !Number.isFinite(p.lon)
      )
    ) {
      throw new Error(
        "位置情報の形式が正しくありません"
      );
    }

    const legs = [];

    for (
      let i = 0;
      i < points.length - 1;
      i++
    ) {
      const leg = await routeOne(
        points[i],
        points[i + 1],
        key
      );

      legs.push({
        ...leg,
        from:
          i === 0
            ? points[0].label
            : stops[i - 1].name,
        to: stops[i].name
      });
    }

    return {
      statusCode: 200,
      headers: {
        "content-type":
          "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        originLabel: points[0].label,
        legs
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        "content-type":
          "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        error: e.message
      })
    };
  }
};
