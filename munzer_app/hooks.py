app_name = "munzer_app"
app_title = "Munzer App"
app_publisher = "Monzerdh"
app_description = "Custom inventory tooling for ORAS — Item Master Report S + Inventory Workstation"
app_email = "Monzerdh@users.noreply.github.com"
app_license = "MIT"
required_apps = ["erpnext"]

# Document Events
# ---------------
# Broadcast Serial No changes to live workstations. Only fires on sites where
# munzer_app is installed, so other sites in the same bench are unaffected.
doc_events = {
	"Serial No": {
		"on_update": "munzer_app.munzer_app.api.broadcast_serial_update",
	}
}
