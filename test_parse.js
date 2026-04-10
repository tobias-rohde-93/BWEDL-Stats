// Test Ligapokal date parsing and timestamp generation
var testLines = [
    "10.04.2026 20:00   DC Texas Team - DC Mephisto's   :",
    "10.5.26 0:00   the Metal Darts - Mighty Darts   :",
    "24.04.2026 20:00   DC Reloaded - DC Lachs 14   :",
    "23.03.2026 20:00   DC Green Scorpion's - DC Ungültig   10:6"
];

testLines.forEach(function (trimmed) {
    var dashIdx = trimmed.indexOf(" - ");
    var leftPart = trimmed.substring(0, dashIdx).trim();

    // Date extraction
    var dateExtract = leftPart.match(
        /(?:[A-Za-z]{2}\.\s+)?(\d{1,2}\.\s*\d{1,2}\.\d{4})(?:\s+\d{1,2}:\d{2})?/
    );
    var dateStr = dateExtract ? dateExtract[1].replace(/\s/g, "") : "";

    // Timestamp
    var ts = 0;
    if (dateStr) {
        var parts = dateStr.split(".");
        if (parts.length === 3) ts = new Date(parts[2], parts[1] - 1, parts[0]).getTime();
    }

    console.log("leftPart:", leftPart);
    console.log("  dateStr:", dateStr, "| ts:", ts, "| date:", ts ? new Date(ts).toDateString() : "INVALID");
    console.log("");
});
