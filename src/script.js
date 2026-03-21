// ---- 状態 ----
var totalRounds = 5;
var currentRound = 0;
var totalScore = 0;
var distances = [];

var panorama = null;
var guessMap = null;
var guessMarker = null;
var answerLatLng = null;
var resultMarker = null;
var resultLine = null;

// 地図オーバーレイの状態
var mapLocked = false;
var sizeStage = 0; // 0=小(25%), 1=中(50%), 2=大(70%)
var SIZE_RATIOS = [0.25, 0.50, 0.70];

// ---- DOM キャッシュ ----
function $(id) { return document.getElementById(id); }

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

    $('round-select-screen').style.display = 'none';
    $('game-screen').style.display = '';

    panorama = new google.maps.StreetViewPanorama($('street-view'), {
        addressControl: false,
        showRoadLabels: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
        enableCloseButton: false,
        zoomControl: true,
        panControl: true,
        linksControl: true
    });

    guessMap = new google.maps.Map($('guess-map'), {
        center: { lat: 36, lng: 140 },
        zoom: 5,
        clickableIcons: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        styles: [
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

    setupMapOverlay();
    nextRound();
}

// ============================================================
// 推測用地図のオーバーレイ制御
// ============================================================
function setupMapOverlay() {
    var container = $('map-container');
    var btnLock = $('btn-lock');
    var btnResize = $('btn-resize');

    container.addEventListener('mouseenter', function () {
        if (!mapLocked) {
            applyExpandedSize(container);
            container.classList.add('expanded');
        }
    });

    container.addEventListener('mouseleave', function () {
        if (!mapLocked) {
            container.style.width = '200px';
            container.style.height = '120px';
            container.classList.remove('expanded');
            resizeMapTiles();
        }
    });

    btnLock.addEventListener('click', function (e) {
        e.stopPropagation();
        mapLocked = !mapLocked;
        btnLock.classList.toggle('active', mapLocked);
        if (mapLocked) {
            applyExpandedSize(container);
            container.classList.add('expanded');
        } else {
            container.style.width = '200px';
            container.style.height = '120px';
            container.classList.remove('expanded');
        }
        resizeMapTiles();
    });

    btnResize.addEventListener('click', function (e) {
        e.stopPropagation();
        sizeStage = (sizeStage + 1) % 3;
        if (mapLocked || container.classList.contains('expanded')) {
            applyExpandedSize(container);
            resizeMapTiles();
        }
    });
}

function applyExpandedSize(container) {
    var ratio = SIZE_RATIOS[sizeStage];
    var w = Math.round(window.innerWidth * ratio);
    var h = Math.round(w * 3 / 4);
    container.style.width = w + 'px';
    container.style.height = h + 'px';
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
                panorama.setPano(data.location.pano);
                panorama.setPov({ heading: Math.random() * 360, pitch: 0 });
                panorama.setVisible(true);
            } else {
                findRandomStreetView(attempt + 1);
            }
        }
    );
}

// ============================================================
// Guess 処理
// ============================================================
function onGuess() {
    if (!guessMarker || !answerLatLng) return;

    $('btn-guess').disabled = true;

    var guessLatLng = guessMarker.getPosition();
    var distanceM = google.maps.geometry.spherical.computeDistanceBetween(answerLatLng, guessLatLng);
    var distanceKm = distanceM / 1000;
    var score = Math.round(5000 * Math.exp(-distanceKm / 2000));

    totalScore += score;
    distances.push(distanceKm);

    showResult(distanceKm, score);
}

// ============================================================
// リザルト表示
// ============================================================
function showResult(distanceKm, score) {
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

    $('result-distance').textContent = '距離: ' + distanceKm.toFixed(1) + ' km';
    $('result-score').textContent = 'スコア: ' + score + ' / 5000';
    $('result-total').textContent = '累計スコア: ' + totalScore;

    $('btn-next').textContent = currentRound >= totalRounds ? '結果を見る' : 'Next Round';
    $('result-panel').style.display = '';
}

// ============================================================
// Next Round / 結果を見る
// ============================================================
function onNextRound() {
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

    var avgDist = distances.reduce(function (a, b) { return a + b; }, 0) / distances.length;

    $('end-total-score').textContent = '合計スコア: ' + totalScore + ' / ' + (totalRounds * 5000);
    $('end-avg-distance').textContent = '平均距離: ' + avgDist.toFixed(1) + ' km';
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
    answerLatLng = null;
    mapLocked = false;
    sizeStage = 0;

    if (guessMarker) { guessMarker.setMap(null); guessMarker = null; }
    if (resultMarker) { resultMarker.setMap(null); resultMarker = null; }
    if (resultLine) { resultLine.setMap(null); resultLine = null; }

    $('btn-lock').classList.remove('active');
    var container = $('map-container');
    container.style.width = '200px';
    container.style.height = '120px';
    container.classList.remove('expanded');

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

