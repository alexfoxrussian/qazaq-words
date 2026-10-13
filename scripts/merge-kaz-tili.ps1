$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$directory = Join-Path $root 'imports/kaz-tili'
$inputs = @('dictionary.json', 'frequent/dictionary.json')
$topics = [ordered]@{}
$words = [ordered]@{}
$inputWords = 0

function Clean([string]$value) { $value.Normalize().Trim() -replace '\s+', ' ' }
function Key([string]$value) { (Clean $value).ToLowerInvariant() }

foreach ($inputFile in $inputs) {
    $data = Get-Content -LiteralPath (Join-Path $directory $inputFile) -Raw | ConvertFrom-Json
    if ($data.format -ne 'qazaq-words-dictionary' -or $data.version -ne 1) { throw "Неверный формат: $inputFile" }
    foreach ($topic in $data.topics) {
        $name = Clean $topic
        $topicKey = Key $name
        if (!$topics.Contains($topicKey)) { $topics[$topicKey] = $name }
    }
    foreach ($word in $data.words) {
        $inputWords++
        $kazakh = Clean $word.kazakh
        $russian = Clean $word.russian
        if (!$kazakh -or !$russian) { throw "Пустое поле: $inputFile" }
        $pair = ConvertTo-Json -InputObject @((Key $kazakh), (Key $russian)) -Compress
        if (!$words.Contains($pair)) {
            $words[$pair] = [ordered]@{ kazakh = $kazakh; russian = $russian; topics = @() }
        }
        foreach ($topic in $word.topics) {
            $topicKey = Key $topic
            if (!$topics.Contains($topicKey)) { throw "Неизвестный тег: $topic" }
            $name = $topics[$topicKey]
            if ($words[$pair].topics -notcontains $name) { $words[$pair].topics += $name }
        }
    }
}

$result = [ordered]@{ format = 'qazaq-words-dictionary'; version = 1; topics = @($topics.Values); words = @($words.Values) }
$target = Join-Path $directory 'merged-dictionary.json'
[System.IO.File]::WriteAllText($target, (ConvertTo-Json -InputObject $result -Depth 6) + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output ("Сохранено {0} уникальных пар, {1} тегов. Объединено совпадений: {2}. Файл: {3}" -f $words.Count, $topics.Count, ($inputWords - $words.Count), $target)
