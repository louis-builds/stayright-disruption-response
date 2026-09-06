using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCalls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "calls",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    case_id = table.Column<Guid>(type: "uuid", nullable: false),
                    callee_type = table.Column<string>(type: "text", nullable: false),
                    initiated_by_coordinator_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_calls", x => x.id);
                    table.ForeignKey(
                        name: "fk_calls_cases_case_id",
                        column: x => x.case_id,
                        principalTable: "cases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "call_recordings",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    call_id = table.Column<Guid>(type: "uuid", nullable: false),
                    file_url = table.Column<string>(type: "text", nullable: false),
                    duration_seconds = table.Column<int>(type: "integer", nullable: false),
                    transcript_text = table.Column<string>(type: "text", nullable: true),
                    ai_summary = table.Column<string>(type: "text", nullable: true),
                    processing_status = table.Column<string>(type: "text", nullable: false),
                    reviewed = table.Column<bool>(type: "boolean", nullable: false),
                    coordinator_note = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_call_recordings", x => x.id);
                    table.ForeignKey(
                        name: "fk_call_recordings_calls_call_id",
                        column: x => x.call_id,
                        principalTable: "calls",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_call_recordings_call_id",
                table: "call_recordings",
                column: "call_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_calls_case_id",
                table: "calls",
                column: "case_id");

            migrationBuilder.CreateIndex(
                name: "ix_calls_initiated_by_coordinator_id",
                table: "calls",
                column: "initiated_by_coordinator_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "call_recordings");

            migrationBuilder.DropTable(
                name: "calls");
        }
    }
}
