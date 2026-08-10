# Kill any Node dev servers left running on common ports
$ports = 5174, 5199, 5173
$killed = 0

foreach ($port in $ports) {
	$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
	if ($conn) {
		Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
		Write-Host "Killed process on port $port"
		$killed = 1
	}
}

if ($killed -eq 0) {
	Write-Host "No servers running on those ports"
}
