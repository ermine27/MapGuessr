// ---- 状態 ----
var totalRounds = 5;
var currentRound = 0;
var totalScore = 0;
var distances = [];
var scores = [];
var roundTimes = [];

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

function formatDistance(km) {
    if (km < 1) {
        return Math.round(km * 1000) + ' m';
    }
    return km.toFixed(1) + ' km';
}

// ---- Google Maps コールバック（グローバルに公開が必要） ----
function initGame() {
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

    $('round-select-screen').style.display = 'none';
    $('game-screen').style.display = '';

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
    nextRound();
}

// ============================================================
// コンパス
// ============================================================
function updateCompass() {
    if (!panorama) return;
    var heading = panorama.getPov().heading;
    var needle = $('compass-needle');
    if (needle) needle.setAttribute('transform', 'rotate(' + heading + ', 24, 24)');
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
    checkpointData = null;
    startPanoData = null;
    moveHistory = [];
    currentPanoId = null;
    updateCheckpointButton();
    updateMoveBackButton();

    // タイマーリセット
    clearInterval(roundTimerInterval);
    $('timer-info').textContent = '00:00';
    roundStartTime = Date.now();
    roundTimerInterval = setInterval(function () {
        var elapsed = Math.floor((Date.now() - roundStartTime) / 1000);
        $('timer-info').textContent = formatTime(elapsed);
    }, 1000);

    findRandomStreetView(0);
}

function updateStatus() {
    $('round-info').textContent = 'Round ' + currentRound + ' / ' + totalRounds;
    $('total-score-info').textContent = 'Score: ' + totalScore;
}

// ============================================================
// ランダムストリートビュー取得
// ============================================================
function findRandomStreetView(attempt) {
    if (attempt >= 20) {
        $('game-screen').style.display = 'none';
        $('error-screen').style.display = '';
        return;
    }

    var lat = 24 + Math.random() * (46 - 24);
    var lng = 123 + Math.random() * (146 - 123);
    var latLng = new google.maps.LatLng(lat, lng);

    var sv = new google.maps.StreetViewService();
    sv.getPanorama(
        { location: latLng, radius: 3000, source: google.maps.StreetViewSource.OUTDOOR },
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

function onReturnToTitle() {
    if (!confirm('ゲームを終了してタイトルに戻りますか？')) return;
    clearInterval(roundTimerInterval);
    resetGame();
}

// ============================================================
// Guess 処理
// ============================================================
function onGuess() {
    if (!guessMarker || !answerLatLng) return;

    $('btn-guess').disabled = true;

    // タイマー停止・記録
    clearInterval(roundTimerInterval);
    var roundTime = Math.floor((Date.now() - roundStartTime) / 1000);
    roundTimes.push(roundTime);

    var guessLatLng = guessMarker.getPosition();
    var distanceM = google.maps.geometry.spherical.computeDistanceBetween(answerLatLng, guessLatLng);
    var distanceKm = distanceM / 1000;
    var score = Math.round(5000 * Math.exp(-distanceKm / 2000));

    totalScore += score;
    distances.push(distanceKm);
    scores.push(score);

    showResult(distanceKm, score, roundTime);
}

// ============================================================
// リザルト表示
// ============================================================
function showResult(distanceKm, score, roundTime) {
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

    $('result-distance').textContent = '距離: ' + formatDistance(distanceKm);
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

    var avgDist = distances.reduce(function (a, b) { return a + b; }, 0) / distances.length;

    $('end-total-score').textContent = '合計スコア: ' + totalScore + ' / ' + (totalRounds * 5000);
    $('end-avg-distance').textContent = '平均距離: ' + avgDist.toFixed(1) + ' km';

    var html = '<table class="round-table"><thead><tr><th>Round</th><th>得点</th><th>距離</th><th>時間</th></tr></thead><tbody>';
    for (var i = 0; i < scores.length; i++) {
        html += '<tr><td>' + (i + 1) + '</td><td>' + scores[i] + '</td><td>' + formatDistance(distances[i]) + '</td><td>' + formatTime(roundTimes[i]) + '</td></tr>';
    }
    html += '</tbody></table>';
    $('round-results-table').innerHTML = html;

    $('end-screen').style.display = '';

    $('btn-restart').addEventListener('click', function handler() {
        $('btn-restart').removeEventListener('click', handler);
        resetGame();
    });
}

function resetGame() {
    totalScore = 0;
    currentRound = 0;
    distances = [];
    scores = [];
    roundTimes = [];
    answerLatLng = null;
    mapLocked = false;
    isMapHovered = false;
    sizeStage = 0;
    clearInterval(roundTimerInterval);
    roundTimerInterval = null;
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
                'Google Maps API の読み込みに失敗しました。APIキーを確認してください。' +
                'ページをリロードすると再入力できます。';
        };
        document.head.appendChild(script);
    }
}());

