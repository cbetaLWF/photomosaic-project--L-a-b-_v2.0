document.addEventListener('DOMContentLoaded', () => {
    const dropArea = document.getElementById('drop-area');
    const startButton = document.getElementById('start-analysis');
    const downloadButton = document.getElementById('download-json-button');
    const logDiv = document.getElementById('log');
    
    let uploadedFiles = [];
    let jsonResults = null; // 解析結果を保持する変数

    // --- ドロップゾーンの設定 ---
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('active'), false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('active'), false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    dropArea.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        // 画像ファイルのみをフィルタリング
        uploadedFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (uploadedFiles.length > 0) {
            logDiv.textContent = `ログ: ${uploadedFiles.length}個の画像ファイルが選択されました。\nファイル名はそのまま使用されます。`;
            startButton.disabled = false;
            downloadButton.disabled = true; // 新しいファイルがドロップされたら無効化
            jsonResults = null;
        } else {
            logDiv.textContent = 'ログ: 画像ファイルが見つかりません。';
            startButton.disabled = true;
            downloadButton.disabled = true;
        }
    }

    // --- 解析開始ボタン ---
    startButton.addEventListener('click', () => {
        if (uploadedFiles.length === 0) return;
        
        logDiv.textContent = 'ログ: 解析を開始します... (UIフリーズを防ぐためWorkerを使用)';
        startButton.disabled = true;
        downloadButton.disabled = true;
        
        // Workerを起動
        const worker = new Worker('worker_v2.0.js'); // ★ファイル名をv2.0に修正

        // Workerにファイルリストを送信
        worker.postMessage({ files: uploadedFiles });

        // Workerからのメッセージ受信
        worker.onmessage = (e) => {
            if (e.data.type === 'progress') {
                const progress = Math.round(e.data.progress * 100);
                logDiv.textContent = `進捗: ${progress}% - 処理中: ${e.data.fileName}`;
            } else if (e.data.type === 'error') {
                logDiv.textContent += `\nERROR: ${e.data.message}`;
            } else if (e.data.type === 'complete') {
                jsonResults = e.data.results;
                logDiv.textContent = `\n--- 解析完了 --- \n${jsonResults.length}個のタイルデータを生成しました。JSONダウンロードボタンを押してください。`;
                
                downloadButton.disabled = false;
                startButton.disabled = false;
                worker.terminate();
            }
        };

        worker.onerror = (error) => {
            logDiv.textContent += `\nWorkerエラー: ${error.message}`;
            startButton.disabled = false;
            worker.terminate();
        };
    });

    // --- JSONダウンロードボタン ---
    downloadButton.addEventListener('click', () => {
        if (!jsonResults) {
            logDiv.textContent += '\nエラー: JSONデータがまだ生成されていません。';
            return;
        }
        
        const jsonContent = JSON.stringify(jsonResults, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        
        // Blob URLを生成し、ダウンロードを実行
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tile_data.json';
        
        // ダウンロード実行 (DOMに一時的に追加してクリック)
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url); // オブジェクトURLを解放
        
        logDiv.textContent += '\n\n★重要★ tile_data.jsonをダウンロードしました。\n次に、アップロードした画像ファイルをリネームせずに /mosaic/tiles/ フォルダに移動させてください。';
        downloadButton.disabled = true;
    });
});
