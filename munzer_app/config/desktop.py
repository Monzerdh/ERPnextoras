from frappe import _


def get_data():
	return [
		{
			"module_name": "Munzer App",
			"category": "Modules",
			"label": _("Munzer App"),
			"color": "#E8173A",
			"icon": "octicon octicon-package",
			"type": "module",
			"description": "Custom inventory tooling for ORAS",
		}
	]
