// ---- 状態 ----
var totalRounds = 5;
var currentRound = 0;
var totalScore = 0;
var distances = [];
var scores = [];
var roundTimes = [];
var guessPositions = [];   // ラウンドごとの推測位置 (google.maps.LatLng)
var answerPositions = [];  // ラウンドごとの正解位置 (google.maps.LatLng)

var panorama = null;
var guessMap = null;
var guessMarker = null;
var answerLatLng = null;
var resultMarker = null;
var resultLine = null;

// 地図オーバーレイの状態
var mapLocked = false;
var isMapHovered = false;
var sizeStage = 0; // 0=小(25%), 1=中(50%), 2=大(70%)

// タイマー
var roundTimerInterval = null;
var roundStartTime = 0;

// No Moveモード・移動履歴・チェックポイント
var allowMove = true;           // false = 移動系ボタン非表示（No Move時）
var moveHistory = [];            // 移動前pano IDのスタック（移動を戻す用）
var currentPanoId = null;        // 現在表示中のpano ID
var isProgrammaticPanoChange = false; // プログラムによる遷移フラグ
var startPanoData = null;        // ラウンド開始時の { pano, pov }
var checkpointData = null;       // チェックポイント { pano, pov } または null
var northRotateAnimId = null;    // 北向きアニメーション用 rAF ID

// 制限時間モード
var roundTimeLimit = 0;          // 0 = 制限なし、それ以外は秒数
var timeWarningActive = false;   // 残り10秒以下の警告フラグ
var flashInterval = null;        // 警告点滅用インターバル

// ---- 北向きアニメーション速度 ----
var NORTH_ROTATE_SPEED = 540; // degrees/second（大きくすると速く、小さくすると遅くなります）

// ---- マップ設定 ----
var currentMapKey = 'japan'; // 使用するマップ（maps/ フォルダのファイル名と対応）

// ---- 表示設定 ----
var showMapLabels = true; // true: 国名・地名等を表示、false: 非表示
var showCompass = true;  // true: コンパスを表示、false: 非表示

// ---- DOM キャッシュ ----
function $(id) { return document.getElementById(id); }

// ---- ユーティリティ ----
function formatTime(totalSec) {
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function formatTimeLimitLabel(val) {
    if (val === 0) return '制限なし';
    var totalSec = val * 10;
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    if (m === 0) return s + '秒';
    if (s === 0) return m + '分';
    return m + '分' + s + '秒';
}

function updateTimeLimitLabel() {
    var slider = $('time-limit-slider');
    var label = $('time-limit-label');
    if (slider && label) label.textContent = formatTimeLimitLabel(parseInt(slider.value, 10));
}

function formatDistance(km) {
    if (km < 1) {
        return Math.round(km * 1000) + ' m';
    }
    return km.toFixed(1) + ' km';
}

// ---- Google Maps コールバック（グローバルに公開が必要） ----
function initGame() {
    setupKeyboardShortcuts();
    $('btn-retry-round').onclick = retryCurrentRound;
    $('btn-error-to-title').onclick = function () {
        $('error-screen').style.display = 'none';
        resetGame();
    };
    setupRoundSelect();
}

// ============================================================
// ラウンドセレクター
// ============================================================
function setupRoundSelect() {
    $('round-select-screen').style.display = '';
    $('game-screen').style.display = 'none';
    $('end-screen').style.display = 'none';
    $('error-screen').style.display = 'none';
    $('setup-screen').style.display = 'none';

    // APIキー変更ボタン（毎回 onclick で上書きして重複リスナーを防ぐ）
    $('btn-change-key').onclick = function () {
        localStorage.removeItem('mapguessr_api_key');
        location.reload();
    };

    // ラウンド時間スライダーの初期化
    var slider = $('time-limit-slider');
    if (slider) {
        updateTimeLimitLabel();
        slider.oninput = updateTimeLimitLabel;
    }

    document.querySelectorAll('.round-btn[data-rounds]').forEach(function (btn) {
        btn.addEventListener('click', function handler() {
            btn.removeEventListener('click', handler);
            totalRounds = parseInt(this.dataset.rounds, 10);
            startGame();
        });
    });
}

// ============================================================
// ゲーム開始
// ============================================================
function startGame() {
    currentRound = 0;
    totalScore = 0;
    distances = [];
    scores = [];
    roundTimes = [];
    guessPositions = [];
    answerPositions = [];

    $('round-select-screen').style.display = 'none';
    $('game-screen').style.display = '';

    // 制限時間の読み込み
    var sliderVal = parseInt(($('time-limit-slider') || {}).value || '0', 10);
    roundTimeLimit = isNaN(sliderVal) ? 0 : sliderVal * 10;

    panorama = new google.maps.StreetViewPanorama($('street-view'), {
        addressControl: false,
        showRoadLabels: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
        enableCloseButton: false,
        zoomControl: false,
        panControl: false,
        linksControl: true
    });

    if (showCompass) {
        $('compass').style.display = '';
        panorama.addListener('pov_changed', updateCompass);
    } else {
        $('compass').style.display = 'none';
    }

    // ストリートビュー移動追跡（移動を戻す用）
    panorama.addListener('pano_changed', function () {
        if (isProgrammaticPanoChange) {
            isProgrammaticPanoChange = false;
            currentPanoId = panorama.getPano();
            return;
        }
        if (currentPanoId !== null) {
            moveHistory.push(currentPanoId);
        }
        currentPanoId = panorama.getPano();
        updateMoveBackButton();
    });

    guessMap = new google.maps.Map($('guess-map'), {
        center: { lat: 36, lng: 140 },
        zoom: 5,
        clickableIcons: false,
        disableDefaultUI: true,
        zoomControl: false,
        styles: showMapLabels ? [] : [
            { elementType: 'labels', stylers: [{ visibility: 'off' }] }
        ]
    });

    guessMap.addListener('click', function (e) {
        if (guessMarker) {
            guessMarker.setMap(null);
        }
        guessMarker = new google.maps.Marker({
            position: e.latLng,
            map: guessMap
        });
        $('btn-guess').disabled = false;
    });

    $('btn-guess').addEventListener('click', onGuess);
    $('btn-next').addEventListener('click', onNextRound);

    $('btn-zoom-in').onclick = function () {
        if (guessMap) guessMap.setZoom(guessMap.getZoom() + 1);
    };
    $('btn-zoom-out').onclick = function () {
        if (guessMap) guessMap.setZoom(Math.max(0, guessMap.getZoom() - 1));
    };

    setupMapOverlay();

    // SVコントロールボタンのセットアップ
    $('btn-sv-zoom-in').onclick = function () {
        if (panorama) panorama.setZoom(panorama.getZoom() + 1);
    };
    $('btn-sv-zoom-out').onclick = function () {
        if (panorama) panorama.setZoom(Math.max(0, panorama.getZoom() - 1));
    };
    $('btn-move-back').onclick = onMoveBack;
    $('btn-checkpoint').onclick = onCheckpoint;
    $('btn-return-start').onclick = onReturnToStart;
    $('btn-return-title').onclick = onReturnToTitle;

    updateNoMoveButtons();
    loadMapData(currentMapKey, function () {
        nextRound();
    });
}

// ============================================================
// マップデータ読み込み（fetch）
// ============================================================
function loadMapData(mapKey, callback) {
    if (window.MAPGUESSR_SEEDS && window.MAPGUESSR_SEEDS[mapKey]) {
        callback();
        return;
    }
    fetch('maps/' + mapKey + '.json')
        .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(function (data) {
            if (!window.MAPGUESSR_SEEDS) window.MAPGUESSR_SEEDS = {};
            window.MAPGUESSR_SEEDS[mapKey] = data;
            callback();
        })
        .catch(function () {
            $('game-screen').style.display = 'none';
            $('error-screen').style.display = '';
            $('error-message').textContent = 'マップデータの読み込みに失敗しました。ページを再読み込みしてください。';
            $('btn-error-reload').style.display = '';
        });
}

// ============================================================
// コンパス
// ============================================================
function updateCompass() {
    if (!panorama) return;
    var heading = panorama.getPov().heading;
    var needle = $('compass-needle');
    // heading はカメラの向き（0=北,90=東）
    // 針は「世界の北方向」を指すので、カメラが東を向く(+90°)と北は左(-90°)にある
    // → 針の回転量は -heading
    if (needle) needle.setAttribute('transform', 'rotate(' + (-heading) + ', 24, 24)');
}

// ============================================================
// 推測用地図のオーバーレイ制御
// ============================================================

// 展開時サイズ（3段階）
var EXPANDED_SIZES = [
    { ratio: 0.25 },
    { ratio: 0.50 },
    { ratio: 0.70 }
];
var MINIMAP_W = 240;
var MINIMAP_H = 180;

function setupMapOverlay() {
    var wrapper = $('map-wrapper');

    setMinimapSize();

    // ホバーで展開（ヒンボタン含むラッパー全体で検知）
    wrapper.addEventListener('mouseenter', function () {
        isMapHovered = true;
        if (!mapLocked) applyExpandedSize();
    });
    wrapper.addEventListener('mouseleave', function () {
        isMapHovered = false;
        if (!mapLocked) setMinimapSize();
    });

    // ピンボタン
    $('btn-pin').onclick = function (e) {
        e.stopPropagation();
        mapLocked = !mapLocked;
        $('btn-pin').classList.toggle('active', mapLocked);
        if (!mapLocked && !isMapHovered) setMinimapSize();
    };

    // ↖ 展開サイズ拡大（sizeStage を上げる）
    $('btn-size-up').onclick = function (e) {
        e.stopPropagation();
        if (sizeStage < 2) {
            sizeStage++;
            if (isMapHovered || mapLocked) applyExpandedSize();
            updateSizeButtons();
        }
    };

    // ↘ 展開サイズ縮小（sizeStage を下げる）
    $('btn-size-down').onclick = function (e) {
        e.stopPropagation();
        if (sizeStage > 0) {
            sizeStage--;
            if (isMapHovered || mapLocked) applyExpandedSize();
            updateSizeButtons();
        }
    };
}

function setMinimapSize() {
    var container = $('map-container');
    container.style.width = MINIMAP_W + 'px';
    container.style.height = MINIMAP_H + 'px';
    container.style.opacity = '0.75';
    syncWrapperWidth(MINIMAP_W);
    resizeMapTiles();
}

function applyExpandedSize() {
    var container = $('map-container');
    var s = EXPANDED_SIZES[sizeStage];
    var w = s.w || Math.round(window.innerWidth * s.ratio);
    var h = s.h || Math.round(w * 3 / 4);
    container.style.width = w + 'px';
    container.style.height = h + 'px';
    container.style.opacity = '1';
    syncWrapperWidth(w);
    updateSizeButtons();
    resizeMapTiles();
}

function syncWrapperWidth(w) {
    var header = $('map-header');
    var footer = $('map-footer');
    if (header) header.style.width = w + 'px';
    if (footer) footer.style.width = w + 'px';
}

function updateSizeButtons() {
    $('btn-size-up').disabled = (sizeStage === 2);
    $('btn-size-down').disabled = (sizeStage === 0);
}

function resizeMapTiles() {
    if (guessMap) {
        google.maps.event.trigger(guessMap, 'resize');
    }
}

// ============================================================
// ラウンド進行
// ============================================================
function nextRound() {
    currentRound++;
    updateStatus();

    if (guessMarker) { guessMarker.setMap(null); guessMarker = null; }
    if (resultMarker) { resultMarker.setMap(null); resultMarker = null; }
    if (resultLine) { resultLine.setMap(null); resultLine = null; }

    $('btn-guess').disabled = true;
    $('result-panel').style.display = 'none';

    guessMap.setCenter({ lat: 36, lng: 140 });
    guessMap.setZoom(5);

    // チェックポイント・移動履歴リセット
    if (northRotateAnimId) { cancelAnimationFrame(northRotateAnimId); northRotateAnimId = null; }
    checkpointData = null;
    startPanoData = null;
    moveHistory = [];
    currentPanoId = null;
    updateCheckpointButton();
    updateMoveBackButton();

    // タイマーリセット
    clearInterval(roundTimerInterval);
    startRoundTimer();

    findRandomStreetView(0);
}

function updateStatus() {
    $('round-info').textContent = 'Round ' + currentRound + ' / ' + totalRounds;
    $('total-score-info').textContent = 'Score: ' + totalScore;
}

function startRoundTimer() {
    stopTimeWarning();
    roundStartTime = Date.now();
    if (roundTimeLimit > 0) {
        $('timer-info').style.display = 'none';
        $('countdown-bar').style.display = '';
        var cd = $('countdown-timer');
        cd.textContent = formatTime(roundTimeLimit);
        cd.classList.remove('warning');
        roundTimerInterval = setInterval(function () {
            var elapsed = Math.floor((Date.now() - roundStartTime) / 1000);
            var remaining = roundTimeLimit - elapsed;
            if (remaining <= 0) {
                clearInterval(roundTimerInterval);
                roundTimerInterval = null;
                onTimeout();
                return;
            }
            $('countdown-timer').textContent = formatTime(remaining);
            if (remaining <= 10) startTimeWarning();
        }, 250);
    } else {
        $('timer-info').style.display = '';
        $('countdown-bar').style.display = 'none';
        $('timer-info').textContent = '00:00';
        roundTimerInterval = setInterval(function () {
            var elapsed = Math.floor((Date.now() - roundStartTime) / 1000);
            $('timer-info').textContent = formatTime(elapsed);
        }, 1000);
    }
}

// ============================================================
// ランダムストリートビュー取得（シードポイント + ランダムオフセット方式）
// ============================================================
function findRandomStreetView(attempt) {
    // ---- 調整可能な定数 ----
    var MAX_ATTEMPTS = 20;    // 最大試行回数
    var OFFSET_DEG = 0.3;   // シードから散らす最大幅（度）～約 33 km
    var SEARCH_RADIUS = 5000;  // getPanorama の検索半径（m）
    // ------------------------

    if (attempt >= MAX_ATTEMPTS) {
        showStreetViewError();
        return;
    }

    var mapData = window.MAPGUESSR_SEEDS && window.MAPGUESSR_SEEDS[currentMapKey];
    if (!mapData || !mapData.seeds || mapData.seeds.length === 0) {
        $('game-screen').style.display = 'none';
        $('error-screen').style.display = '';
        $('error-message').textContent = 'マップデータが読み込まれていません。ページを再読み込みしてください。';
        $('btn-error-reload').style.display = '';
        return;
    }

    var seeds = mapData.seeds;
    var seed = seeds[Math.floor(Math.random() * seeds.length)];
    var lat = seed.lat + (Math.random() * 2 - 1) * OFFSET_DEG;
    var lng = seed.lng + (Math.random() * 2 - 1) * OFFSET_DEG;
    var latLng = new google.maps.LatLng(lat, lng);

    var sv = new google.maps.StreetViewService();
    sv.getPanorama(
        { location: latLng, radius: SEARCH_RADIUS, source: google.maps.StreetViewSource.OUTDOOR },
        function (data, status) {
            if (status === google.maps.StreetViewStatus.OK) {
                answerLatLng = data.location.latLng;
                var startPano = data.location.pano;
                var startPov = { heading: Math.random() * 360, pitch: 0 };
                moveHistory = [];
                checkpointData = null;
                startPanoData = { pano: startPano, pov: startPov };
                currentPanoId = startPano;
                isProgrammaticPanoChange = true;
                panorama.setPano(startPano);
                panorama.setPov(startPov);
                panorama.setVisible(true);
                updateMoveBackButton();
                updateCheckpointButton();
            } else {
                findRandomStreetView(attempt + 1);
            }
        }
    );
}

function showStreetViewError() {
    clearInterval(roundTimerInterval);
    stopTimeWarning();
    $('game-screen').style.display = 'none';
    $('error-screen').style.display = '';
    $('error-message').textContent = 'ストリートビューが見つかりませんでした。再試行するか、タイトルに戻ってください。';
    $('btn-retry-round').style.display = '';
    $('btn-error-to-title').style.display = '';
}

function retryCurrentRound() {
    $('btn-retry-round').style.display = 'none';
    $('btn-error-to-title').style.display = 'none';
    $('error-screen').style.display = 'none';
    $('game-screen').style.display = '';
    // タイマーリセット
    clearInterval(roundTimerInterval);
    startRoundTimer();
    findRandomStreetView(0);
}

// ============================================================
// 制限時間ウォーニング・タイムアウト処理
// ============================================================
function startTimeWarning() {
    if (timeWarningActive) return;
    timeWarningActive = true;
    var cd = $('countdown-timer');
    if (cd) cd.classList.add('warning');
    var overlay = $('time-warning-overlay');
    if (overlay) {
        overlay.style.display = '';
        flashInterval = setInterval(function () {
            overlay.classList.toggle('flash-on');
        }, 500);
    }
}

function stopTimeWarning() {
    timeWarningActive = false;
    if (flashInterval) { clearInterval(flashInterval); flashInterval = null; }
    var cd = $('countdown-timer');
    if (cd) cd.classList.remove('warning');
    var overlay = $('time-warning-overlay');
    if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('flash-on'); }
}

function onTimeout() {
    if ($('result-panel').style.display !== 'none') return;
    stopTimeWarning();
    clearInterval(roundTimerInterval);
    roundTimerInterval = null;
    var cd = $('countdown-timer');
    if (cd) cd.textContent = '00:00';
    $('btn-guess').disabled = true;
    var roundTime = roundTimeLimit;
    if (guessMarker && answerLatLng) {
        // ピンあり: ピン位置で採点
        roundTimes.push(roundTime);
        var guessLatLng = guessMarker.getPosition();
        var distanceM = google.maps.geometry.spherical.computeDistanceBetween(answerLatLng, guessLatLng);
        var distanceKm = distanceM / 1000;
        var score = Math.round(5000 * Math.exp(-distanceKm / 2000));
        totalScore += score;
        distances.push(distanceKm);
        scores.push(score);
        guessPositions.push(guessLatLng);
        answerPositions.push(answerLatLng);
        showResult(distanceKm, score, roundTime, false);
    } else if (answerLatLng) {
        // ピンなし: 0点
        roundTimes.push(roundTime);
        distances.push(null);
        scores.push(0);
        guessPositions.push(null);
        answerPositions.push(answerLatLng);
        showResult(null, 0, roundTime, true);
    }
}

// ============================================================
// SVコントロール ヘルパー
// ============================================================
function updateMoveBackButton() {
    var btn = $('btn-move-back');
    if (btn) btn.disabled = (moveHistory.length === 0);
}

function updateCheckpointButton() {
    var isSet = checkpointData !== null;
    var iconUnset = $('icon-cp-unset');
    var iconSet = $('icon-cp-set');
    if (iconUnset) iconUnset.style.display = isSet ? 'none' : '';
    if (iconSet) iconSet.style.display = isSet ? '' : 'none';
    var btn = $('btn-checkpoint');
    if (btn) {
        btn.title = isSet ? 'チェックポイントに戻る (C)' : 'チェックポイントを設定 (C)';
        btn.classList.toggle('active', isSet);
    }
}

function updateNoMoveButtons() {
    var btns = document.querySelectorAll('.sv-btn-nomove');
    btns.forEach(function (btn) {
        btn.style.display = allowMove ? '' : 'none';
    });
}

// ============================================================
// SVコントロール アクション
// ============================================================
function onMoveBack() {
    if (!allowMove || moveHistory.length === 0) return;
    if ($('result-panel').style.display !== 'none') return;
    var prevPano = moveHistory.pop();
    isProgrammaticPanoChange = true;
    panorama.setPano(prevPano);
    currentPanoId = prevPano;
    updateMoveBackButton();
}

function onCheckpoint() {
    if (!allowMove) return;
    if ($('result-panel').style.display !== 'none') return;
    if (checkpointData === null) {
        // チェックポイントを記憶
        checkpointData = { pano: panorama.getPano(), pov: panorama.getPov() };
    } else {
        // チェックポイントに戻る
        isProgrammaticPanoChange = true;
        panorama.setPano(checkpointData.pano);
        panorama.setPov(checkpointData.pov);
        currentPanoId = checkpointData.pano;
        checkpointData = null;
    }
    updateCheckpointButton();
}

function onReturnToStart() {
    if (!allowMove || !startPanoData) return;
    if ($('result-panel').style.display !== 'none') return;
    isProgrammaticPanoChange = true;
    panorama.setPano(startPanoData.pano);
    panorama.setPov(startPanoData.pov);
    currentPanoId = startPanoData.pano;
    moveHistory = [];
    updateMoveBackButton();
}

// ============================================================
// 北向きアニメーション
// ============================================================
function rotateToNorthAnimated() {
    if (northRotateAnimId) {
        cancelAnimationFrame(northRotateAnimId);
        northRotateAnimId = null;
    }
    var lastTime = null;
    function animate(timestamp) {
        if (!lastTime) lastTime = timestamp;
        var elapsed = timestamp - lastTime;
        lastTime = timestamp;

        var pov = panorama.getPov();
        // 現在の heading を [0, 360) に正規化
        var current = ((pov.heading % 360) + 360) % 360;
        // 最短経路での目標 0 への差分（[-180, 180]）
        var delta = current <= 180 ? -current : 360 - current;

        var maxDeg = NORTH_ROTATE_SPEED * (elapsed / 1000);
        if (Math.abs(delta) <= maxDeg) {
            panorama.setPov({ heading: 0, pitch: pov.pitch });
            northRotateAnimId = null;
            return;
        }
        panorama.setPov({ heading: pov.heading + (delta > 0 ? maxDeg : -maxDeg), pitch: pov.pitch });
        northRotateAnimId = requestAnimationFrame(animate);
    }
    northRotateAnimId = requestAnimationFrame(animate);
}

function onReturnToTitle() {
    var overlay = $('modal-overlay');
    overlay.style.display = 'flex';
    $('btn-modal-confirm').onclick = function () {
        overlay.style.display = 'none';
        clearInterval(roundTimerInterval);
        resetGame();
    };
    $('btn-modal-cancel').onclick = function () {
        overlay.style.display = 'none';
    };
}

// ============================================================
// キーボードショートカット
// ============================================================
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function (e) {
        if ($('game-screen').style.display === 'none') return;
        var resultVisible = $('result-panel').style.display !== 'none';
        switch (e.code) {
            case 'Space':
                if (e.target && e.target.tagName === 'BUTTON') break;
                e.preventDefault();
                if (resultVisible) {
                    $('btn-next').click();
                } else {
                    if (!$('btn-guess').disabled) $('btn-guess').click();
                }
                break;
            case 'KeyZ':
                if (!resultVisible && allowMove) onMoveBack();
                break;
            case 'KeyC':
                if (!resultVisible && allowMove) onCheckpoint();
                break;
            case 'KeyR':
                if (!resultVisible && allowMove) onReturnToStart();
                break;
            case 'KeyN':
                if (!resultVisible && panorama) {
                    rotateToNorthAnimated();
                }
                break;
        }
    });
}

// ============================================================
// Guess 処理
// ============================================================
function onGuess() {
    if (!guessMarker || !answerLatLng) return;

    $('btn-guess').disabled = true;

    // タイマー停止・記録
    clearInterval(roundTimerInterval);
    stopTimeWarning();
    var roundTime = Math.floor((Date.now() - roundStartTime) / 1000);
    roundTimes.push(roundTime);

    var guessLatLng = guessMarker.getPosition();
    var distanceM = google.maps.geometry.spherical.computeDistanceBetween(answerLatLng, guessLatLng);
    var distanceKm = distanceM / 1000;
    var score = Math.round(5000 * Math.exp(-distanceKm / 2000));

    totalScore += score;
    distances.push(distanceKm);
    scores.push(score);
    guessPositions.push(guessLatLng);
    answerPositions.push(answerLatLng);

    showResult(distanceKm, score, roundTime);
}

// ============================================================
// リザルト表示
// ============================================================
function showResult(distanceKm, score, roundTime, isTimeout) {
    // 地図を最大サイズに拡大・固定
    mapLocked = true;
    sizeStage = 2;
    applyExpandedSize();
    $('btn-pin').classList.add('active');

    resultMarker = new google.maps.Marker({
        position: answerLatLng,
        map: guessMap,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#00c853',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2
        }
    });

    // 正解ピンをクリックでストリートビューを新タブで開く
    resultMarker.addListener('click', function () {
        var streetViewUrl = 'https://maps.google.com/?cbll=' + answerLatLng.lat() + ',' + answerLatLng.lng() + '&layer=c';
        window.open(streetViewUrl, '_blank');
    });

    resultLine = null;
    if (!isTimeout && guessMarker) {
        resultLine = new google.maps.Polyline({
            path: [guessMarker.getPosition(), answerLatLng],
            map: guessMap,
            strokeColor: '#e94560',
            strokeWeight: 3,
            strokeOpacity: 0.8
        });

        var bounds = new google.maps.LatLngBounds();
        bounds.extend(guessMarker.getPosition());
        bounds.extend(answerLatLng);
        guessMap.fitBounds(bounds, 40);
    } else {
        guessMap.setCenter(answerLatLng);
        guessMap.setZoom(8);
    }

    $('result-distance').textContent = isTimeout ? 'タイムオーバー' : '距離: ' + formatDistance(distanceKm);
    $('result-score').textContent = 'スコア: ' + score;
    $('result-total').textContent = '累計スコア: ' + totalScore;
    $('result-time').textContent = '経過時間: ' + formatTime(roundTime);

    $('btn-next').textContent = currentRound >= totalRounds ? '結果を見る' : 'Next Round';
    $('result-panel').style.display = '';
}

// ============================================================
// Next Round / 結果を見る
// ============================================================
function onNextRound() {
    // 結果表示中に拡大した地図をミニマップに戻す
    mapLocked = false;
    $('btn-pin').classList.remove('active');
    if (!isMapHovered) setMinimapSize();

    if (currentRound >= totalRounds) {
        showEndScreen();
    } else {
        nextRound();
    }
}

// ============================================================
// ゲーム終了画面
// ============================================================
function showEndScreen() {
    $('game-screen').style.display = 'none';
    $('result-panel').style.display = 'none';
    clearInterval(roundTimerInterval);

    var validDists = distances.filter(function (d) { return d !== null; });
    var avgDist = validDists.length > 0 ? validDists.reduce(function (a, b) { return a + b; }, 0) / validDists.length : 0;

    $('end-total-score').textContent = '合計スコア: ' + totalScore + ' / ' + (totalRounds * 5000);
    $('end-avg-distance').textContent = '平均距離: ' + avgDist.toFixed(1) + ' km';

    var html = '<table class="round-table"><thead><tr><th>Round</th><th>得点</th><th>距離</th><th>時間</th></tr></thead><tbody>';
    for (var i = 0; i < scores.length; i++) {
        var distStr = distances[i] === null ? 'タイムオーバー' : formatDistance(distances[i]);
        html += '<tr><td>' + (i + 1) + '</td><td>' + scores[i] + '</td><td>' + distStr + '</td><td>' + formatTime(roundTimes[i]) + '</td></tr>';
    }
    html += '</tbody></table>';
    $('round-results-table').innerHTML = html;

    $('end-screen').style.display = '';

    // 結果マップを初期化・描画
    initEndMap();

    $('btn-restart').addEventListener('click', function handler() {
        $('btn-restart').removeEventListener('click', handler);
        resetGame();
    });
}

var endMap = null;
var endMapMarkers = [];
var endMapLines = [];

function initEndMap() {
    var container = $('end-map');
    if (!container) return;

    // 地図を初期化（または再利用）
    if (!endMap) {
        endMap = new google.maps.Map(container, {
            center: { lat: 36, lng: 140 },
            zoom: 3,
            clickableIcons: false,
            disableDefaultUI: true,
            zoomControl: true,
            styles: showMapLabels ? [] : [
                { elementType: 'labels', stylers: [{ visibility: 'off' }] }
            ]
        });
    }

    // 前回のマーカー・線をクリア
    endMapMarkers.forEach(function (m) { m.setMap(null); });
    endMapLines.forEach(function (l) { l.setMap(null); });
    endMapMarkers = [];
    endMapLines = [];

    var bounds = new google.maps.LatLngBounds();

    for (var i = 0; i < answerPositions.length; i++) {
        var roundNum = i + 1;
        var ansPos = answerPositions[i];
        var guessPos = guessPositions[i];

        // 正解マーカー: 数字付きラベル
        var ansMarker = new google.maps.Marker({
            position: ansPos,
            map: endMap,
            label: {
                text: String(roundNum),
                color: '#fff',
                fontSize: '12px',
                fontWeight: 'bold'
            },
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 14,
                fillColor: '#00c853',
                fillOpacity: 1,
                strokeColor: '#fff',
                strokeWeight: 2
            },
            title: 'Round ' + roundNum + ' 正解'
        });
        endMapMarkers.push(ansMarker);

        // 正解ピンをクリックでストリートビューを新タブで開く
        ansMarker.addListener('click', function () {
            var streetViewUrl = 'https://maps.google.com/?cbll=' + ansPos.lat() + ',' + ansPos.lng() + '&layer=c';
            window.open(streetViewUrl, '_blank');
        });

        // 推測マーカー・線（タイムアウトでピンなしの場合はskip）
        if (guessPos) {
            var guessMarkerEnd = new google.maps.Marker({
                position: guessPos,
                map: endMap,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: '#e94560',
                    fillOpacity: 1,
                    strokeColor: '#fff',
                    strokeWeight: 1.5
                },
                title: 'Round ' + roundNum + ' 推測'
            });
            endMapMarkers.push(guessMarkerEnd);

            // 線
            var line = new google.maps.Polyline({
                path: [guessPos, ansPos],
                map: endMap,
                strokeColor: '#e94560',
                strokeWeight: 2,
                strokeOpacity: 0.6
            });
            endMapLines.push(line);

            bounds.extend(guessPos);
        }

        bounds.extend(ansPos);
    }

    endMap.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 });
    google.maps.event.trigger(endMap, 'resize');
}

function resetGame() {
    totalScore = 0;
    currentRound = 0;
    distances = [];
    scores = [];
    roundTimes = [];
    guessPositions = [];
    answerPositions = [];
    answerLatLng = null;
    mapLocked = false;
    isMapHovered = false;
    sizeStage = 0;
    clearInterval(roundTimerInterval);
    roundTimerInterval = null;
    stopTimeWarning();
    $('countdown-bar').style.display = 'none';
    $('timer-info').style.display = '';
    if (northRotateAnimId) { cancelAnimationFrame(northRotateAnimId); northRotateAnimId = null; }
    moveHistory = [];
    currentPanoId = null;
    startPanoData = null;
    checkpointData = null;
    isProgrammaticPanoChange = false;

    if (guessMarker) { guessMarker.setMap(null); guessMarker = null; }
    if (resultMarker) { resultMarker.setMap(null); resultMarker = null; }
    if (resultLine) { resultLine.setMap(null); resultLine = null; }

    var btnPin = $('btn-pin');
    if (btnPin) btnPin.classList.remove('active');
    setMinimapSize();

    $('end-screen').style.display = 'none';
    setupRoundSelect();
}

// ============================================================
// Google Maps JavaScript API の動的ロード
// APIキーは localStorage('mapguessr_api_key') から取得します
// ============================================================
(function loadMapsApi() {
    var STORAGE_KEY = 'mapguessr_api_key';
    var key = localStorage.getItem(STORAGE_KEY);

    if (!key) {
        showSetupScreen();
        return;
    }

    loadScript(key);

    function showSetupScreen() {
        $('round-select-screen').style.display = 'none';
        $('setup-screen').style.display = '';

        var input = $('api-key-input');
        var btn = $('btn-save-key');

        btn.addEventListener('click', function () {
            var entered = input.value.trim();
            if (!entered) return;
            localStorage.setItem(STORAGE_KEY, entered);
            $('setup-screen').style.display = 'none';
            loadScript(entered);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') btn.click();
        });
    }

    function loadScript(apiKey) {
        var script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js' +
            '?key=' + encodeURIComponent(apiKey) +
            '&libraries=geometry' +
            '&callback=initGame';
        script.async = true;
        script.defer = true;
        script.onerror = function () {
            // キーが無効な可能性があるので削除してリロードを促す
            localStorage.removeItem(STORAGE_KEY);
            $('game-screen').style.display = 'none';
            $('error-screen').style.display = '';
            $('error-message').textContent =
                'Google Maps API の読み込みに失敗しました。APIキーを確認して、ページを再読み込みしてください。';
            $('btn-error-reload').style.display = '';
        };
        document.head.appendChild(script);
    }
}());

